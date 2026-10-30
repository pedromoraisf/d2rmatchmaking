# D2R Match Making · Design Doc

Oct 29, 2026 · @Pedro

O D2R Match Making nasce como um monólito modular em Node.js 26 LTS, com front em React e um agente desktop em Tauri com núcleo Rust, tudo num monorepo no GitHub. Ele roda em planos gratuitos (Cloudflare Pages, Render, Neon) e tem OpenTelemetry, pirâmide de testes com mutação e harness L4 desde o walking skeleton. Este documento traz as decisões e os insumos para os ADRs do desenvolvimento por SDD. Requisitos e escopo estão no PRD.

## Contexto e objetivos técnicos

- **Domínio no centro.** As regras de fila, sala, presença e ranking ficam em código sem dependência de framework, testável em memória.
- **Provedor na borda.** Tudo que é específico de Render, Neon ou Cloudflare fica na camada de montagem do app. Trocar de provedor não toca o domínio.
- **Observável desde o dia 0.** Um trace atravessa site, API, banco e agente.
- **Seguro para agentes de código.** Guias e sensores no repositório fazem o agente errar menos e corrigir sozinho quando erra.
- **Custo zero no MVP**, com o caminho de saída do plano gratuito já desenhado.

Versões: Node.js 26 é a LTS ativa desde outubro de 2026 (a 24 entrou em manutenção) ([endoflife.date](https://endoflife.date/nodejs)). React não tem linha LTS; usamos a versão estável atual, a 19. No agente, a interface é React e o núcleo é Rust; o Node.js entra só no build da interface, não em tempo de execução.

## Visão geral

&#91;embedded content: topologia · 2 clientes, 1 API, 4 serviços externos\]

A API no Render é o único processo com estado em memória e o único que fala com banco, armazenamento, Battle.net e telemetria. O site é estático, e o agente só fala com a API e com o GitHub Releases para se atualizar.

## Infraestrutura e plataformas

Para o front, a recomendação é o Cloudflare Pages: o plano Hobby da Vercel é só para uso não comercial, e o Pages não tem essa restrição e dá banda estática ilimitada ([AgentDeals](https://agentdeals.dev/hosting-free-tier-comparison-2026)). A montagem do front fica isolada para trocar se for preciso.

| Peça | Plataforma | Limite que importa no plano gratuito | Quando sair |
| --- | --- | --- | --- |
| Site (SPA) | Cloudflare Pages | Sem limite de banda estática; 500 builds/mês | Dificilmente no MVP |
| API, SSE e worker | Render, web service free | 512 MB, 750 h/mês, dorme após 15 min sem tráfego, 5 GB de banda/mês ([Render em 2026](https://jwatte.com/blog/render-com-platform-review.md)) | Banda perto do limite, ou mais de uma instância |
| Postgres | Neon free | 1 GB por projeto, 100 CU-hora/mês, hiberna após 5 min ([Neon](https://neon.com/guides/neon-vs-supabase-free-plan)) | Heartbeats indo para o banco, ou mais de 1 GB |
| Prints de disputa | Cloudflare R2 | Camada gratuita de armazenamento | Volume de prints acima do gratuito |
| Código, CI e releases do agente | GitHub, GitHub Actions, GitHub Releases | Grátis em repositório público | — |
| Telemetria | Grafana Cloud free (ou Datadog depois) | 10 mil séries de métrica, 50 GB de logs e 50 GB de traces por mês, 14 dias de retenção ([CostBench](https://costbench.com/software/observability/grafana-cloud/free-plan/)) | Volume ou retenção acima disso |

Consequências de projeto do custo zero:

- **Uma instância da API, com o worker no mesmo processo.** O Render free não tem serviço de worker, e 750 h/mês cobrem um serviço ligado o mês inteiro.
- **Sem Redis no MVP.** O Upstash grátis dá 500 mil comandos por mês, e mil agentes em heartbeat gastariam dezenas de milhões. Presença e pub/sub ficam em memória atrás das portas `PresenceStore` e `EventBus`.
- **Heartbeat nunca vai para o Postgres.** Só mudanças de estado são gravadas, para o Neon poder hibernar e caber nas 100 CU-hora.
- **Payloads enxutos** de heartbeat e SSE, por causa dos 5 GB de banda do Render.
- **Backup diário** por workflow agendado (`pg_dump` para o R2), porque os bancos gratuitos não têm backup.

## Modelo de domínio

Cinco contextos, três de núcleo e dois de suporte. O agente fala direto com o dono de cada informação: o aceite vai para o Matchmaking, as observações para a Lobby Room, e só o que é sobre o dispositivo vai para Agentes.

| Contexto | Tipo | Agregados | Responsabilidade |
| --- | --- | --- | --- |
| Identidade | Suporte | `Account`, `Character` | Conta vinculada à Battle.net; personagens declarados com classe, nível, ladder, era e dificuldades liberadas |
| Agentes | Suporte | `Agent` | Pareamento, token, presença (online, jogo aberto, tela), versão mínima, configuração remota, entrega da atribuição |
| Matchmaking | Núcleo | `QueueTicket`, `ReadyCheck` | Filas por modo, região do jogo, dificuldade, ladder e era; faixas de ELO e nível; composição do grupo; ready check e penalidades |
| Lobby Room | Núcleo | `LobbyRoom` (com `Member`, `Run`, `ScoreReport`) | Sala, host, nome da partida, estados, observações, runs, placar, disputa |
| Ranking | Núcleo | `Rating`, `Season` | ELO por personagem e dificuldade, contagem de runs, patentes, ranking |

**Invariantes que o domínio garante:**

- Um `QueueTicket` só casa com outros da mesma região do jogo, dificuldade, ladder e era. A faixa de ELO pode abrir; esses três filtros, nunca.
- Um personagem só entra na fila de uma dificuldade liberada nele e, no leveling, com nível no mínimo igual ao piso daquela dificuldade.
- Uma `LobbyRoom` só vai a Criada com uma observação válida do host, e a Ativa quando todos os membros estão confirmados.
- Uma conta tem no máximo uma fila ou sala ativa por vez.
- O ELO só muda com resultado confirmado pelos dois lados, ou decidido por moderador.
- Observações são idempotentes: a mesma chave não muda o estado duas vezes.

* Só entra na fila quem tem agente pareado e online, Battle.net vinculada e site conectado. Não existe confirmação manual.
* Se o site ou o agente de um membro cair além da tolerância configurada, ele sai da sala de forma controlada; se for o host, o papel de host passa ao próximo membro por ordem de entrada.

- Disputas seguem uma pipeline: (1) pareamento das observações dos agentes dos dois lados; (2) se ainda divergirem, decisão pela hierarquia da sala, que começa no host e segue os demais membros por ordem de entrada crescente. A `LobbyRoom` guarda a ordem de entrada de cada membro.

**Eventos entre contextos** (gravados na tabela de outbox e publicados no `EventBus` do processo):

| Evento | Publica | Consome |
| --- | --- | --- |
| `AgentPresenceChanged` | Agentes | Matchmaking, Lobby Room |
| `MatchFormed` | Matchmaking | Lobby Room |
| `ReadyCheckFailed` | Matchmaking | Matchmaking (recoloca os demais) |
| `RoomAssignmentChanged` | Lobby Room | Agentes (entrega ao dispositivo) |
| `RoomStageChanged` | Lobby Room | Camada de apresentação (SSE) |
| `RunCompleted` | Lobby Room | Ranking |
| `MatchResultConfirmed` | Lobby Room | Ranking |
| `MemberAbandoned` | Lobby Room | Ranking (W.O.) |

**Linguagem ubíqua:**

| Termo | Significado |
| --- | --- |
| Dificuldade | Normal, Pesadelo ou Inferno; filtro fixo de pareamento |
| Ladder | Combinação de SC ou HC com ladder ou non-ladder |
| Era | LoD, RotW ou Classic; define economia e conteúdos disponíveis |
| Ticket | A entrada de uma conta na fila, com personagem e preferências |
| Ready check | Janela de 1 minuto para todos aceitarem a partida encontrada; se falhar, quem aceitou volta ao topo da fila |
| Lobby Room | A sala da plataforma que corresponde a uma partida no jogo |
| Host | Membro que cria a partida no jogo; no leveling, o teleportador |
| Run | Uma partida dentro de uma sessão de leveling; cada uma tem nome próprio e nenhuma tem senha |
| Observação | Fato lido pelo agente, como "nome da partida visto" ou "jogador entrou" |
| Presença | Estado do dispositivo: online, jogo aberto, tela atual |
| Atribuição | O que o agente deve procurar agora: sala, run, nome esperado, membros |
| Patente | Faixa de ELO com nome de runa, de Tal a Zod |

## Arquitetura do código

&#91;embedded content: camadas de um módulo e a montagem por provedor\]

A forma mais enxuta que atende ao pedido tem quatro camadas: três dentro de cada módulo (`domain`, `application`, `adapters`) e uma montagem global (`main`), que é a camada mais "suja". Ela é a única que sabe que roda no Render, que o banco é o Neon e qual backend de telemetria está em uso. Um `main/local.ts` monta o mesmo app com Postgres em Docker e telemetria local.

| Camada | Pode importar | Não pode importar |
| --- | --- | --- |
| `domain` | `shared-kernel` | Qualquer outra camada, outro módulo, bibliotecas de I/O |
| `application` | `domain` do próprio módulo, `shared-kernel`, porta pública de outro módulo | `adapters`, `main`, Fastify, Kysely |
| `adapters` | `application` e `domain` do próprio módulo, bibliotecas de I/O | `main`, internos de outro módulo |
| `main` | Tudo | — (ninguém importa `main`) |

No site, a mesma ideia em escala menor: `features/` por contexto, `shared/` e `app/` como montagem. No agente Rust, as regras são garantidas pela separação em crates do workspace.

**Regras do dependency-cruiser** (trecho de `.dependency-cruiser.cjs`):

```js
module.exports = {
  forbidden: [
    { name: "domain-is-pure", severity: "error",
      from: { path: "^apps/api/src/modules/[^/]+/domain" },
      to: { pathNot: ["^apps/api/src/modules/[^/]+/domain", "^apps/api/src/shared-kernel"] } },
    { name: "application-no-adapters", severity: "error",
      from: { path: "^apps/api/src/modules/[^/]+/application" },
      to: { path: ["/adapters/", "^apps/api/src/main", "node_modules/(fastify|kysely|pg)"] } },
    { name: "no-cross-module-internals", severity: "error",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: { path: "^apps/api/src/modules/([^/]+)/(domain|application|adapters)/", pathNot: "^apps/api/src/modules/$1/" } },
    { name: "nobody-imports-main", severity: "error",
      from: { pathNot: "^apps/api/src/main" },
      to: { path: "^apps/api/src/main" } },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } }
  ]
};
```

## Estrutura do monorepo e stack

Um repositório só, público, com pnpm workspaces e Turborepo para cache e para rodar só o que foi afetado. Ser público é o que permite o updater do agente ler as releases sem autenticação, dá minutos de Actions gratuitos e abre a porta para a assinatura gratuita da SignPath Foundation.

```text
d2r-match-making/
├─ apps/
│  ├─ web/                 React 19 + Vite (SPA)
│  ├─ api/                 Node.js 26, monólito modular
│  │  └─ src/
│  │     ├─ modules/
│  │     │  ├─ identity/      domain/ application/ adapters/
│  │     │  ├─ agents/
│  │     │  ├─ matchmaking/
│  │     │  ├─ lobby-room/
│  │     │  └─ ranking/
│  │     ├─ shared-kernel/   ids, Result, Clock, eventos, portas comuns
│  │     └─ main/            montagem por provedor: local.ts, render.ts
│  └─ agent/               Tauri 2
│     ├─ src-tauri/        núcleo Rust (sensores, fusão, fila local)
│     └─ ui/               React 19
├─ packages/
│  ├─ contracts/          schemas Zod → JSON Schema (consumidos pelo Rust)
│  ├─ telemetry/          bootstrap OpenTelemetry para Node e navegador
│  └─ config/             presets de tsconfig, ESLint e Prettier
├─ docs/
│  ├─ domain/             contextos, glossário, invariantes
│  ├─ engineering/        restrições, padrões, como testar
│  ├─ adr/                ADRs numerados
│  └─ specs/              specs do SDD por feature
├─ .claude/              settings.json, hooks/, skills/, commands/, agents/
├─ .cursor/rules/        regras com escopo por pasta
├─ AGENTS.md             guia canônico; CLAUDE.md importa ele
├─ .dependency-cruiser.cjs
├─ .harness-score.json
├─ lefthook.yml
└─ .github/workflows/
```

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Linguagem | TypeScript em modo strict | Um idioma no site, na API e na interface do agente |
| Runtime | Node.js 26 LTS | LTS ativa até outubro de 2027 |
| HTTP e SSE | Fastify 5 | Leve, modelo de plugins, controle direto da resposta para SSE |
| Contratos | Zod 4 com exportação para JSON Schema | Fonte única de validação para API, site e, via JSON Schema, Rust |
| Acesso a dados | Kysely + driver `pg` | SQL tipado sem ORM pesado; repositórios ficam finos |
| Autenticação | `openid-client` com Battle.net; sessão em cookie httpOnly | OAuth só no backend |
| Front | React 19, Vite, TanStack Router e TanStack Query, `EventSource` | SPA estática no Pages; SSE nativo do navegador |
| Agente | Tauri 2, Rust estável; `windows-capture`, OCR do Windows, `imageproc`, `sysinfo`, `tokio`, `reqwest`, `rusqlite`, `typify` | Captura e OCR nativos, binário pequeno, tipos gerados dos contratos |
| Lint e formatação | ESLint 9 + typescript-eslint, Prettier; `clippy -D warnings`, `rustfmt` | Sensores de estética e padrões |
| Arquitetura | dependency-cruiser | Sensor das regras de camadas e módulos |
| Testes | Vitest, Testcontainers, Playwright, StrykerJS; `cargo nextest`, `insta`, `cargo-mutants` | Pirâmide completa com mutação |
| Telemetria | OpenTelemetry JS (Node e web), `opentelemetry` para Rust | Padrão aberto, backend trocável |
| Ganchos locais | Lefthook | Pre-commit e pre-push rápidos, configurados no repositório |

## Contratos

Todos os contratos vivem em `packages/contracts` como schemas Zod. O site e a API importam direto; o Rust recebe o JSON Schema gerado e tipos criados pelo `typify`. Um teste de contrato no CI falha se o JSON Schema gerado mudar sem a versão do contrato mudar junto.

**OpenAPI.** A especificação OpenAPI 3.1 é gerada dos mesmos schemas Zod e das rotas do Fastify (`@fastify/swagger` com o type provider de Zod). Ela fica versionada em `packages/contracts/openapi.json` e é servida pela API em `/docs` com Swagger UI, só fora de produção. O comando `pnpm contracts:openapi` regenera o arquivo. O CI falha se o arquivo gerado for diferente do versionado, então nenhuma mudança de rota ou schema passa sem o OpenAPI acompanhar. Os eventos SSE, que o OpenAPI não descreve bem, ficam documentados num AsyncAPI ao lado.

**REST** (prefixo `/v1`; o agente envia `X-Agent-Version`, e versões abaixo da mínima recebem `426 Upgrade Required`):

| Método e rota | Quem chama | Contexto | Para quê |
| --- | --- | --- | --- |
| `GET /auth/bnet/login`, `GET /auth/bnet/callback` | Site | Identidade | OAuth da Battle.net e criação da sessão |
| `GET/POST/PATCH /me/characters` | Site | Identidade | Personagens declarados |
| `POST /agents/pairing-codes`, `POST /agents/pair` | Agente, site | Agentes | Agente pede um código; site logado confirma; API emite token do agente |
| `DELETE /agents/{id}` | Site | Agentes | Revogar agente |
| `POST /agents/heartbeat` | Agente | Agentes | Presença, tela atual, taxa de leitura |
| `GET /agents/me/assignment` | Agente | Agentes | Atribuição atual (sala, run, nome esperado, membros) |
| `POST /queue/tickets`, `DELETE /queue/tickets/{id}` | Site | Matchmaking | Entrar e sair da fila |
| `POST /ready-checks/{id}/accept`, `/decline` | Site, agente | Matchmaking | Responder ao ready check |
| `GET /lobby-rooms?status=open&mode=&difficulty=` | Site | Lobby Room | Salas ao vivo |
| `GET /lobby-rooms/{id}` | Site, agente | Lobby Room | Estado da sala |
| `POST /lobby-rooms/{id}/join` | Site | Lobby Room | Entrar numa sala com vaga |
| `POST /lobby-rooms/{id}/observations` | Agente | Lobby Room | Fatos lidos na tela, com chave de idempotência |
| `POST /lobby-rooms/{id}/runs` | Host | Lobby Room | Próxima run |
| `POST /lobby-rooms/{id}/score-reports` | Site, agente | Lobby Room | Rounds do PvP |
| `POST /lobby-rooms/{id}/disputes` | Site | Lobby Room | Abrir disputa e pedir URL assinada de upload do print |
| \`GET /rankings?board=pvp | leveling&difficulty=\` | Site | Ranking |

**SSE**: um stream por cliente, `GET /v1/stream`, autenticado pela sessão (site) ou pelo token (agente). O servidor envia só os eventos daquele usuário, cada um com `id` para retomada via `Last-Event-ID`, e um comentário de keep-alive a cada 25 s.

| Evento SSE | Para quem | Conteúdo |
| --- | --- | --- |
| `queue.updated` | Site | Posição, tempo de espera, faixa atual |
| `ready_check.started` / `ready_check.resolved` | Site, agente | Prazo, membros, resultado |
| `room.assigned` | Site, agente | Sala, run, nome, host, membros esperados |
| `room.stage_changed` | Site | Estágio e presença de cada membro |
| `room.run_opened` | Site, agente | Nova run com nome novo |
| `match.result` | Site | Placar confirmado e variação de ELO |

**Observação do agente** (tipos fechados; o servidor descarta o que não reconhece):

```json
{
  "idempotencyKey": "01JC7Q2R8T6K3M4N5P6Q7R8S9T",
  "type": "GAME_NAME_SEEN",
  "run": 7,
  "value": "mmbaalh-07",
  "confidence": 0.94,
  "signals": { "ocr": 0.91, "sameServerAsHost": true },
  "capturedAt": "2026-10-29T23:41:07.512Z"
}
```

Tipos no MVP: `GAME_NAME_SEEN`, `PLAYER_JOINED_SEEN`, `PLAYER_LEFT_SEEN`, `SCREEN_CHANGED`, `ROUND_REPORTED`.

No PvP, o tipo `PLAYER_SLAIN_SEEN` (mensagem de morte no chat) alimenta o placar. Um round só conta quando os agentes dos dois lados enviam a mesma leitura.

**Heartbeat:**

```json
{
  "agentVersion": "0.3.1",
  "pcState": "IN_ROOM_JOINING",
  "game": { "running": true, "window": "foreground", "screen": "AUTOMAP_OPEN" },
  "assignment": { "roomId": "4821", "run": 7 },
  "capture": { "method": "window", "readRate": 0.97 }
}
```

## Modelo de dados

Cada módulo é dono de um schema do Postgres e só ele lê e escreve ali. Nenhuma consulta cruza schemas; um módulo que precisa de dado de outro usa a porta pública dele ou um evento. Isso deixa a extração de um módulo para serviço próprio, no futuro, sem cirurgia no banco.

| Schema.tabela | Colunas principais | Observação |
| --- | --- | --- |
| `identity.accounts` | id, bnet\_sub, battletag, created\_at | `bnet_sub` é o identificador estável do OAuth |
| `identity.sessions` | id, account\_id, expires\_at | Sessão do site |
| `identity.characters` | id, account\_id, name, class, level, ladder, era, unlocked\_difficulties | Nome é o que aparece no chat do jogo |
| `agents.agents` | id, account\_id, token\_hash, version, paired\_at, revoked\_at | Token guardado só como hash |
| `agents.pairing_codes` | code, agent\_id, expires\_at | Vale 5 minutos |
| `matchmaking.matches` | id, mode, difficulty, ladder, era, formed\_at, ready\_check\_result | Histórico de grupos formados |
| `matchmaking.penalties` | account\_id, reason, until | Espera por recusa ou abandono |
| `lobby.rooms` | id, match\_id, mode, activity, difficulty, host\_account\_id, stage, current\_run, created\_at, closed\_at | Agregado `LobbyRoom` |
| `lobby.members` | room\_id, account\_id, character\_id, role, presence, confirmed\_at | Presença confirmada sempre pelo agente |
| `lobby.runs` | room\_id, number, game\_name, opened\_at, completed\_at | Uma linha por run |
| `lobby.observations` | idempotency\_key, room\_id, agent\_id, type, value, confidence, captured\_at | Retenção de 30 dias |
| `lobby.score_reports` | room\_id, account\_id, round, winner\_side, reported\_at | Rounds de cada lado |
| `lobby.disputes` | id, room\_id, status, evidence\_keys, resolved\_by | Prints no R2, por chave |
| `ranking.ratings` | character\_id, difficulty, season\_id, elo, wins, losses, runs | Chave composta personagem + dificuldade + temporada |
| `ranking.seasons` | id, starts\_at, ends\_at | Temporada da plataforma |
| `platform.outbox` | id, event\_type, payload, created\_at, published\_at | Eventos entre módulos |

Ficam fora do Postgres no MVP: filas, ready checks em andamento e presença dos agentes. Vivem em memória atrás das portas `QueueStore`, `ReadyCheckStore` e `PresenceStore`. Se a API reiniciar, quem estava na fila reentra quando o SSE reconecta. Esse é o ponto de troca para Redis quando houver mais de uma instância.

Migrações com o migrator do Kysely, versionadas em `apps/api/migrations`, rodadas pelo pipeline antes do deploy.

## Agente desktop

O agente é um app Tauri 2 para Windows que fica na bandeja. O núcleo em Rust faz todo o trabalho; a interface React mostra pareamento, status e consentimento, e conversa com o núcleo só por comandos Tauri tipados.

**Módulos do núcleo** (crates do workspace em `apps/agent/src-tauri`):

| Módulo | Responsabilidade |
| --- | --- |
| `supervisor` | Máquina de estados do PC: jogo fechado, aberto sem sala, na fila, entrando na sala, na partida, minimizado |
| `scheduler` | Liga, desliga e ajusta a frequência de cada sensor conforme o estado, a partir da configuração remota |
| `sensors` | Plugins com o mesmo contrato: processo, tela (template matching), texto (OCR por região), conexões do processo |
| `vision` | Captura em cascata (janela, depois monitor), recortes, hash por região, pré-processamento, OCR do Windows |
| `fusion` | Combina sinais numa observação com confiança; compara com o nome esperado por distância de edição |
| `outbox` | Fila local em SQLite com reenvio, idempotência e limite de tamanho |
| `api_client` | REST, SSE e heartbeat; propaga `traceparent` |
| `hotkeys` | Atalhos globais configuráveis; preencher digita o nome da partida só com o D2R em foco e nunca aperta Enter |
| `telemetry` | OpenTelemetry com exportação OTLP para a API |

**O que o agente nunca faz**, verificado em revisão e documentado no site: abrir o processo do jogo, ler ou escrever memória, injetar código, interceptar rede, capturar fora da janela do jogo, executar comandos vindos do servidor, confirmar ações no jogo pelo jogador.

**Contrato do sensor:**

```rust
pub trait Sensor: Send {
    fn id(&self) -> &'static str;
    fn active_in(&self, state: PcState) -> bool;
    fn interval(&self, state: PcState, cfg: &RemoteConfig) -> Duration;
    fn sample(&mut self, ctx: &Assignment) -> Vec<Signal>;
}
```

A configuração remota (regiões de leitura por resolução e escala, expressões regulares e textos do chat por idioma, limiares de confiança, frequências por estado) é um JSON versionado servido pela API. Um patch do jogo que mude a interface vira uma atualização de configuração, não uma versão nova do agente.

## Observabilidade com OpenTelemetry

&#91;embedded content: fluxo de telemetria · 3 fontes, 1 exportação, backends trocáveis\]

Os três apps emitem traces, métricas e logs no padrão OpenTelemetry. Site e agente enviam OTLP para um relay na API, que guarda a chave do backend; a API exporta tudo junto. Trocar Grafana por Datadog é mudar `OTEL_EXPORTER_OTLP_ENDPOINT` e o cabeçalho de autenticação na camada de montagem, sem tocar no código dos módulos.

**Instrumentação:**

- **API:** auto-instrumentação de HTTP, Fastify e `pg`; spans manuais nos casos de uso (`lobby.observe`, `matchmaking.match`); logs estruturados com `trace_id`; o worker do outbox continua o trace do evento.
- **Site:** OTel Web com `fetch` e navegação; propaga `traceparent` para a API, então o clique em "Procurar partida" e o evento SSE de volta ficam no mesmo trace.
- **Agente:** spans por amostra de sensor e por envio; propaga `traceparent` nas observações, ligando a leitura da tela à mudança de estágio da sala.
- **Atributos de domínio padronizados:** `d2r.room.id`, `d2r.queue.mode`, `d2r.difficulty`, `d2r.ladder`, `d2r.era`, `d2r.agent.version`. Nunca BattleTag nem nome de personagem.

**Métricas de domínio** (as do PRD viram instrumentos):

| Métrica | Tipo | Para quê |
| --- | --- | --- |
| `queue.wait_time` por modo e dificuldade | Histograma | Meta de menos de 3 min até a sala ativa |
| `ready_check.outcome` | Contador | Taxa de aceite e recusas |
| `room.stage_duration` por estágio | Histograma | Onde as salas travam ou expiram |
| `room.member.dropped` | Contador | Saídas controladas por queda do agente ou do site |
| `agent.read_rate` por resolução, escala e idioma | Gauge | Detectar patch que quebrou a leitura |
| `match.dispute_rate` | Contador | Saúde do placar |
| `http.server.response.body.size` | Histograma | Consumo dos 5 GB de banda do Render |

**Visualização e orquestração:**

- **Painéis como código** em `infra/observability/` (JSON do Grafana), revisados em PR: funil fila → ready check → sala criada → sala ativa por dificuldade; mapa de calor de espera por hora e dificuldade; taxa de leitura do agente por resolução e idioma; RED (taxa, erros, duração) por rota; consumo de banda e de CU-hora.
- **SLOs com alerta por consumo de orçamento de erro:** disponibilidade da API, latência de `observations` até o SSE (NFR-01), taxa de leitura do agente.
- **Marcações de deploy e de release do agente** nos painéis, enviadas pelos pipelines, para ligar uma queda a uma versão.
- **OpenTelemetry Collector quando sair do gratuito:** como serviço próprio, ele roteia para dois backends ao mesmo tempo (útil na migração para Datadog), faz amostragem por cauda (guarda 100% dos traces com erro) e filtra dados sensíveis.
- **No dia a dia:** `docker compose up` sobe a imagem `grafana/otel-lgtm` com Grafana, Tempo, Loki e Prometheus locais, e os testes ponta a ponta verificam que um trace completo foi gerado.

## Estratégia de testes

A base da pirâmide é o domínio, testado em memória e em milissegundos. Quanto mais alto o nível, menos testes e mais lentos. Os testes de mutação medem se os testes de baixo realmente pegam erros, e não só se executam as linhas.

| Nível | O que cobre | Ferramenta | Quando roda |
| --- | --- | --- | --- |
| Unitário de domínio | Agregados, invariantes, pareamento, ELO, transições da sala | Vitest | Hook de edição, pre-commit, CI |
| Unitário de aplicação | Casos de uso com portas falsas em memória | Vitest | Pre-commit, CI |
| Unitário do agente | Máquina de estados, agendador, fusão de sinais | `cargo nextest` | Pre-commit, CI |
| Visão com imagens de referência | Prints reais por resolução, escala e idioma → observações esperadas | `insta` (snapshots) | CI |
| Integração de adaptadores | Repositórios Kysely contra Postgres real, outbox, SSE | Vitest + Testcontainers | CI |
| Contrato | JSON Schema gerado igual ao versionado; exemplos do Zod desserializam no Rust | Vitest, `cargo test` | CI |
| Arquitetura | Regras de camadas e módulos | dependency-cruiser | Hook de edição, pre-commit, CI |
| Ponta a ponta | Fila → ready check → sala → presença, com OAuth falso e um agente simulado | Playwright | CI, antes do deploy |
| Mutação (TS) | `domain` e `application` de cada módulo da API | StrykerJS | Incremental nos PRs; completa toda noite |
| Mutação (Rust) | `fusion`, `supervisor`, `scheduler` | `cargo-mutants` | Nos PRs que tocam esses módulos; completa toda noite |
| Carga e escalabilidade | Jornada principal enxuta em rampa até quebrar o SLO | k6 com extensão de SSE | Sob demanda e ao fechar cada fase do roadmap |

Regras:

- **Limiares de mutação:** proposta de 80% para `domain` e 70% para `application`, com o PR falhando abaixo do limiar. A calibrar no walking skeleton.
- **Sem mocks de biblioteca no domínio.** Portas têm implementações em memória reutilizáveis em todos os testes.
- **Relógio injetável** (`Clock`) em tudo que tem prazo: ready check, expiração de sala, pareamento.
- **Imagens de referência do agente** ficam em `apps/agent/fixtures`, com consentimento de quem cedeu os prints, só dos recortes.
- **Teste que falha sempre vem antes da correção** no fluxo de SDD; o agente de código segue essa ordem.

**Teste de carga.** O objetivo é saber até onde a instância gratuita escala. Cada jogador virtual faz só a jornada principal, sem ações acessórias:

1. Abre o stream SSE e inicia o heartbeat do agente.
2. Entra na fila de PvP 1v1 numa dificuldade e região.
3. Aceita o ready check.
4. O agente do host envia `GAME_NAME_SEEN`, e os dois agentes enviam `PLAYER_SLAIN_SEEN` até o FT5.
5. Sai da sala e volta à fila.

Uma variante de leveling junta 8 jogadores e encadeia runs. A carga sobe em degraus até a latência da observação até o SSE passar de 2 s (NFR-01) ou os erros passarem de 1%.

**Critério mínimo:** 100 jogadores simultâneos na jornada principal dentro do NFR-01 e com menos de 1% de erros. Abaixo disso, o teste falha. Na banda, 100 jogadores ligados o mês inteiro cabem nos 5 GB só se cada um gerar no máximo cerca de 70 KB de saída por hora, e o teste mede isso.

O resultado registrado é: jogadores e salas simultâneos no limite, CPU e memória nesse ponto, e bytes por jogador por hora. Esse último número diz quantos jogadores cabem nos 5 GB mensais de banda.

Para não gastar a banda de produção, o teste roda num contêiner local limitado como a instância do Render (`--cpus` e `--memory 512m`), com uma rodada curta de confirmação no staging. Contas de teste entram por um login falso que só existe fora de produção.

## Harness para desenvolvimento agêntico

O repositório nasce em L4 (Self-correcting) no [harness-score](https://github.com/paladini/harness-score): sensores de L3 (testes, lint, tipos, CI a cada push e pre-commit) mais um hook que bloqueia ações arriscadas e um hook que dá retorno enquanto o agente edita, com os scripts versionados. A ferramenta soma 108 pontos em 36 checagens de seis dimensões, todas baseadas em arquivos, sem rede e sem LLM, então o mesmo commit sempre dá a mesma nota. O CI falha abaixo de L4 com `--min-level 4`.

Não consegui abrir o catálogo completo de checagens. A primeira tarefa do walking skeleton é rodar `npx harness-score --json` e fechar o que faltar.

**Guias** (o que orienta o agente antes de agir):

| Guia | Conteúdo |
| --- | --- |
| `AGENTS.md` | Canônico: mapa do repo, comandos, regras invioláveis (entre elas: toda mudança de rota ou schema regenera e versiona o OpenAPI), fluxo de SDD, como testar, o que nunca fazer no agente desktop |
| `CLAUDE.md` | Importa o `AGENTS.md` e acrescenta o que é só do Claude Code |
| `.cursor/rules/` | Regras com escopo por pasta e frontmatter: `domain`, `application`, `adapters`, `main`, `web`, agente Rust |
| `docs/domain/` | Contextos, glossário, invariantes, eventos |
| `docs/engineering/` | Restrições de engenharia, padrões de código, telemetria, como escrever testes |
| `docs/adr/` e `docs/specs/` | Decisões e specs do SDD |
| `.claude/skills/` e `.claude/commands/` | `/spec`, `/plan`, `/adr`, `/check`, `/new-module` |
| `.claude/agents/` | Subagentes de revisão de arquitetura e de testes, com contexto próprio |

**Sensores** (o que verifica o resultado e devolve o erro ao agente):

| Sensor | Ao editar | Pre-commit | Pre-push | CI |
| --- | --- | --- | --- | --- |
| Prettier, ESLint, `rustfmt`, `clippy` | Arquivo editado | Arquivos staged | — | Tudo |
| TypeScript `tsc` | Pacote do arquivo | — | Afetados | Tudo |
| dependency-cruiser | Arquivo editado | Staged | — | Tudo |
| Testes unitários | `vitest related` | Relacionados | Afetados (Turborepo) | Tudo |
| Integração, contrato, ponta a ponta | — | — | — | Tudo |
| Mutação | — | — | — | Incremental no PR, completa à noite |
| Segredos (gitleaks) | — | Staged | — | Tudo |
| harness-score | — | — | — | `--min-level 4` |
| OpenAPI e AsyncAPI em dia | Ao editar rota ou schema | Regenera e compara | — | Falha se o gerado diferir do versionado |

**Hooks do Claude Code** (`.claude/settings.json`, scripts em `.claude/hooks/`):

- **Gate (`PreToolUse`):** bloqueia `rm -rf` fora de pastas temporárias, `git push --force`, `git reset --hard`, `--no-verify`, edição de `.env*` e de migrações já aplicadas, e qualquer comando com a string de conexão de produção.
- **Feedback (`PostToolUse` em edições):** formata, roda lint e dependency-cruiser no arquivo e os testes relacionados, devolvendo os erros na hora.
- **Fechamento (`Stop`):** antes de encerrar a vez, roda tipos e testes afetados; se falhar, o agente continua.

**Higiene:** `.gitignore`, varredura de segredos, licença MIT, lockfile versionado e `.mcp.json` sem credenciais.

## Walking skeleton

O esqueleto é a fatia mais fina que atravessa todas as camadas e todos os ambientes, sem feature de verdade. O caso escolhido é **"sala de teste vira Criada"**: um endpoint só de staging simula um `MatchFormed`; a Lobby Room nasce, o site mostra a sala pelo SSE, um agente pareado lê o nome da partida numa imagem de referência e a sala muda para Criada na tela.

Esse caso toca domínio, aplicação, adaptadores, montagem, outbox, SSE, Postgres, pareamento, heartbeat, observação, telemetria e os três pipelines.

**Critérios de pronto:**

- [ ] Monorepo com `apps/web`, `apps/api`, `apps/agent` e `packages/contracts`, `telemetry`, `config` compilando no CI.
- [ ] Os cinco módulos da API existem com as três camadas, mesmo vazios, e o dependency-cruiser falha numa violação proposital mantida como teste da regra.
- [ ] Site publicado no Cloudflare Pages com preview por PR.
- [ ] API publicada no Render a partir da camada `main/render.ts`, com migração no Neon antes do deploy e `GET /healthz`.
- [ ] Agente `v0.0.1` publicado em GitHub Release pelo tauri-action; instalado, ele se atualiza sozinho para a `v0.0.2`.
- [ ] Botão de download do site aponta para a última release sem redeploy.
- [ ] Pareamento por código e heartbeat funcionando ponta a ponta.
- [ ] Um trace único vai do clique no site à API, ao Postgres, ao outbox e ao evento SSE, visível no backend de telemetria; o agente gera spans próprios ligados pelo `traceparent`.
- [ ] Pelo menos um teste de cada nível da pirâmide rodando no CI, e um relatório de mutação do domínio publicado.
- [ ] Hooks de gate, feedback e fechamento do Claude Code ativos; Lefthook instalado.
- [ ] `harness-score --min-level 4` verde no CI.
- [ ] Backup diário do Postgres rodando por workflow agendado.
- [ ] Estratégia de cookie de sessão entre o domínio do site e o da API decidida e funcionando (veja riscos).

* [ ] Teste de carga da jornada principal rodando e aprovando o mínimo de 100 jogadores simultâneos, e publicando o limite de jogadores e salas e os bytes por jogador por hora.

## CI/CD e releases

Tudo roda no GitHub Actions, com filtros por pasta e o Turborepo executando só o que foi afetado.

| Workflow | Gatilho | O que faz |
| --- | --- | --- |
| `ci.yml` | PR e push | Formatação, lint, tipos, dependency-cruiser, unitários, integração com Testcontainers, contrato, ponta a ponta, mutação incremental, gitleaks, `harness-score --min-level 4` |
| `deploy-web.yml` | Push na `main` em `apps/web` | Build e publicação no Cloudflare Pages; preview automático nos PRs |
| `deploy-api.yml` | Push na `main` em `apps/api` ou `packages/*`, após o CI | Migração no Neon, deploy hook do Render, smoke test em `/healthz`, marcação de deploy na telemetria |
| `release-please.yml` | Push na `main` | Mantém um PR de release do agente com a versão nova (Conventional Commits) e o changelog; ao mergear, cria a tag `agent-v*` |
| `release-agent.yml` | Tag `agent-v*` | Build no `windows-latest` com tauri-action, assinatura do updater, `latest.json`, cópia do instalador com nome fixo, GitHub Release |
| `nightly.yml` | Agendado | Mutação completa, backup `pg_dump` para o R2, relatório do harness-score |

**Distribuição do agente:**

- O site aponta o download para `releases/latest/download/D2RMatchMaking-setup.exe`. O GitHub resolve sempre a última release, sem redeploy do site.
- O plugin de updater do Tauri consulta `releases/latest/download/latest.json` ao abrir e periodicamente, confere a assinatura com a chave pública embutida e instala.
- A API recusa versões abaixo da mínima com `426`, e o agente força a atualização.
- **Duas assinaturas diferentes:** a do updater é uma chave do Tauri, gratuita e obrigatória (`TAURI_SIGNING_PRIVATE_KEY`). A do Windows (Authenticode) evita o aviso do SmartScreen; de graça, só pela [SignPath Foundation](https://signpath.org/terms), que exige licença OSI, aprovação manual por release e uma página de política de assinatura.

**Segredos:** `TAURI_SIGNING_PRIVATE_KEY` e senha, `RENDER_DEPLOY_HOOK`, `NEON_DATABASE_URL` (só para migração e backup), `CLOUDFLARE_API_TOKEN`, `R2_*`, `OTEL_EXPORTER_OTLP_HEADERS`. Ambientes do GitHub (`staging`, `production`) com aprovação para produção.

## Insumos para os ADRs

Cada linha vira um ADR em `docs/adr/` no formato contexto, decisão, alternativas e consequências. Os que estão com status **Proposto** pedem decisão antes de entrar no código.

| ADR | Decisão | Alternativas consideradas | O que pesou | Status |
| --- | --- | --- | --- | --- |
| 001 Monorepo público | Um repositório público com pnpm e Turborepo | Repositórios separados; agente público e API privada | Updater sem autenticação, Actions grátis, SignPath, contratos num só lugar | Aceito: projeto inteiro open source |
| 002 Monólito modular | Cinco módulos com schema próprio e comunicação por portas e eventos | Microsserviços; monólito sem fronteiras | Uma instância no plano gratuito; extração futura sem cirurgia | Aceito |
| 003 Camadas | `domain`, `application`, `adapters` por módulo e `main` por provedor | Hexagonal completa com mais camadas; MVC | A forma mais enxuta que isola domínio e provedor | Aceito |
| 004 Regras de dependência | dependency-cruiser no editor, no pre-commit e no CI | ESLint boundaries; só revisão | Sensor determinístico para agentes de código | Aceito |
| 005 Hospedagem | Cloudflare Pages, Render free, Neon free | Vercel (Hobby não comercial), Railway, Fly.io, VM Oracle | Custo zero; isolado na camada `main` | Aceito, revisar ao sair do gratuito |
| 006 Sem Redis no MVP | Fila, ready check, presença e pub/sub em memória atrás de portas | Upstash Redis; Postgres LISTEN/NOTIFY | 500 mil comandos/mês não cobrem heartbeats; uma instância só | Aceito |
| 007 SSE para push | Um stream por cliente, com `Last-Event-ID` | WebSocket; polling | Unidirecional basta; mais simples atrás de proxy | Aceito |
| 008 Outbox | Eventos gravados na transação e publicados pelo worker | Publicar direto após commit | Sem evento perdido em reinício | Aceito |
| 009 Contratos compartilhados | Zod → JSON Schema → tipos Rust com `typify` | OpenAPI gerado; Protobuf | Uma fonte para TS e Rust sem gerador pesado | Aceito |
| 010 Agente só de leitura de pixels | Captura em cascata, OCR do Windows, sinais do sistema; nada de memória, injeção ou rede do jogo | Leitura de memória; proxy de rede | Risco de banimento e confiança da comunidade | Aceito |
| 011 Autenticação do agente | Pareamento por código de 6 dígitos e token revogável de escopo restrito | Login Battle.net no agente | Agente nunca toca credenciais da Blizzard | Aceito |
| 012 Cookie entre domínios | MVP: o site chama a API por `/api/*` no próprio domínio do Pages, e uma Pages Function repassa ao Render; o cookie fica no mesmo site. O agente continua falando direto com o Render. Ao comprar domínio, migrar para `app.` e `api.` | Domínio próprio desde o início; token no `localStorage` (o `EventSource` não envia cabeçalho de autorização) | `*.pages.dev` e `*.onrender.com` são sites diferentes e o navegador bloqueia o cookie | Aceito; revisar ao comprar domínio |
| 013 Observabilidade | OpenTelemetry nos três apps, OTLP direto para um backend trocável, começando pelo Grafana Cloud | SDK proprietário do Datadog | Sem lock-in; vendor decidido por configuração | Aceito |
| 014 Testes e mutação | Pirâmide com StrykerJS e `cargo-mutants`, limiares por camada | Cobertura de linha como meta | Cobertura não mede se o teste pega erro | Aceito, calibrar limiares |
| 015 Release do agente | release-please, tauri-action, GitHub Releases e updater do Tauri | Servidor próprio de updates; loja da Microsoft | Gratuito e automático | Aceito |
| 016 Assinatura do Windows | SignPath Foundation se o projeto for OSI | Microsoft Artifact Signing (pago); sem assinatura no início | Aviso do SmartScreen afasta usuários | Aceito: licença MIT |
| 017 Nome da partida | `mm{atividade}{dificuldade}-{n}`, sempre sem senha (partida pública no Game List) | Nome gerado aleatório | Legível pela comunidade e verificável por OCR | Aceito |
| 018 ELO por dificuldade | Rating por personagem, dificuldade e temporada; K = 32 | Rating único; Glicko-2 | Simples de explicar; trocável depois | Aceito: por personagem |
| 019 Harness L4 | `AGENTS.md` canônico, hooks de gate, feedback e fechamento, `harness-score --min-level 4` no CI | Só CI | Correção no ciclo do agente, sem humano | Aceito |
| 020 OpenAPI gerado dos contratos | OpenAPI 3.1 gerado de Zod e Fastify, versionado, com checagem de divergência no CI; AsyncAPI para os eventos SSE | OpenAPI escrito à mão (design-first) | Uma fonte só de verdade; agentes de código não esquecem de atualizar | Aceito |

## Riscos técnicos e questões em aberto

| Risco | Mitigação |
| --- | --- |
| Cookie de sessão bloqueado entre `*.pages.dev` e `*.onrender.com` | Domínio próprio (custo anual do domínio) ou proxy por Pages Functions; decidir no ADR 012 |
| Banda de 5 GB/mês do Render | Payloads mínimos, heartbeat adaptativo por estado, métrica de bytes enviados com alerta |
| Neon sem hibernar por tráfego constante | Nenhuma escrita por heartbeat; pool de conexões pequeno; métrica de CU-hora |
| Reinício da única instância perde filas em memória | Reentrada automática quando o SSE reconecta; salas e resultados estão no Postgres |
| Tela cheia exclusiva devolvendo quadro preto | Cascata de captura e fusão de sinais sem imagem; validar na F2 |
| OCR do Windows sem pacote de idioma | Reserva com OCR embarcado (`ocrs` ou Tesseract) |
| Antivírus marcando o agente | Assinatura de código, código aberto, sem técnicas que lembrem cheats |
| Catálogo do harness-score diferente do previsto | Primeira tarefa do esqueleto é rodar `--json` e ajustar |

Questões em aberto:

- [x] Domínio próprio ou proxy para o cookie de sessão (ADR 012)? Decidido: proxy pelo Cloudflare no início e domínio próprio quando compensar. Validar no esqueleto que o SSE atravessa a Pages Function sem cortes.
- [x] Licença do repositório: MIT (ADR 016, decidido).
- [x] Backend de telemetria: Grafana Cloud no MVP (decidido); Datadog fica como opção futura pelo mesmo OTLP.
- [x] ELO por personagem e dificuldade (ADR 018, decidido).

## Fontes

- [harness-score (GitHub)](https://github.com/paladini/harness-score)
- [Walking Skeleton (C2 Wiki)](https://wiki.c2.com/?WalkingSkeleton)
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
- [Node.js — endoflife.date](https://endoflife.date/nodejs)
- [Hosting free tier comparison 2026 (AgentDeals)](https://agentdeals.dev/hosting-free-tier-comparison-2026)
- [Database free tier comparison 2026 (AgentDeals)](https://agentdeals.dev/database-free-tier-comparison-2026)
- [Render.com in mid-2026](https://jwatte.com/blog/render-com-platform-review.md)
- [Neon vs Supabase free plan](https://neon.com/guides/neon-vs-supabase-free-plan)
- [Grafana Cloud free plan (CostBench)](https://costbench.com/software/observability/grafana-cloud/free-plan/)
- [Ship your Tauri v2 app with GitHub Actions](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-github-actions-and-release-automation-part-22-2ef7)
- [SignPath Foundation — termos](https://signpath.org/terms)
- [Blizzard Forums — D2R API Endpoints](https://us.forums.blizzard.com/en/blizzard/t/diablo-ii-resurrected-api-endpoints/16976?page=2)
