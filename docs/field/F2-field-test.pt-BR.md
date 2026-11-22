Checklist de trabalho do mantenedor para a sessão de campo da F2 (em pt-BR, de propósito; os outros docs são em inglês).

# F2 — sessão de campo no PC do jogo

Uma sessão só, na ordem. Fecha: `game-name-reading` T13–T14, `capture-cascade` T13 e T15, `screen-recognition` T12 e T14,
`remote-config` T20 e a brief (Revision 3, NFR-02, NFR-03). **Nenhum print vai para o repositório** (AGENTS.md, "Never do").

## 1. Instalador

- O instalador de teste é um **artefato de workflow**, nunca um Release (`docs/engineering/delivery.md`). `agent.yml` roda
  em todo PR do mesmo repositório que muda `apps/agent/**` e produz o artefato `agent-preview-<sha>` (canal `preview`,
  não assinado, 14 dias). Um push em `main` produz `agent-staging-<sha>`. Não há `workflow_dispatch` em `agent.yml`.
- **O orquestrador** informa o PR e o SHA a usar (o PR mais recente em `phase/F2` que toca `apps/agent`, ou um PR de
  teste dele). Se não houver artefato dentro dos 14 dias, ele abre um PR que toque `apps/agent` para gerar outro.
- Baixe: Actions → run `agent` do PR → Artifacts → `agent-preview-<sha>` (zip). Rode o `.exe` da pasta `nsis`. **Use este
  artefato (canal `preview`).** O `agent-installer-windows` do job `agent-build` do `ci.yml` (descrito em
  `apps/agent/README.md`, "Testing a pull request's installer") é outro build, de teste de CI, que fala com a API do
  `API_BASE_URL`: não é o canal `preview`; não o use nesta sessão.
- **Pré-requisito**: o instalador deve ser construído de um SHA de `phase/F2` que **inclua o PR #156**
  (`feat/F2-telemetry-consent`, brief Revision 4): é ele que traz a chave de diagnósticos usada na etapa 2. O orquestrador
  informa esse SHA; sem ele, não comece.
- **Site e API do instalador preview**: o agente é compilado com `D2RMM_API_BASE` escolhida em `stage-build.yml`
  ("Choose the API the agent is built for"): o canal `preview` segue a **API de preview do PR** quando ela existe (site:
  o deploy de branch do Pages desse PR, com proxy para essa API); senão usa a **API de staging** (`API_BASE_URL`; site
  `https://staging.d2rmatchmaking.pages.dev`). `https://d2rmatchmaking.pages.dev` é **produção**: não use
  (`docs/engineering/delivery.md`). O orquestrador diz qual par (site, API) vale para o SHA.
- Windows 11 com Smart App Control bloqueia o instalador não assinado: desligue para testar. SmartScreen: "Mais
  informações" → "Executar assim mesmo" (`apps/agent/README.md`, "Testing a pull request's installer").
- Se a janela fechar na hora: `Start-Process <exe> -RedirectStandardError $env:TEMP\d2rmm-err.txt -Wait` e leia o arquivo.
- Versão instalada: Configurações → Aplicativos → `D2RMatchMaking Preview` (nome do produto no canal `preview`, `apps/agent/src-tauri/channels.json`; a janela do agente não mostra a versão). No Task Manager, o processo é `d2rmm-agent.exe`.

## 2. Preparação

1. Site: o do par (site, API) que o orquestrador informou na etapa 1 (staging: `https://staging.d2rmatchmaking.pages.dev`; **nunca** `https://d2rmatchmaking.pages.dev`, que é produção). Entre com a conta Battle.net e crie ao menos um personagem.
2. Pareie o agente pelo código de pareamento do site; dê o consentimento de captura (AGN-01, NFR-05).
3. Janela do agente: a chave **"Enviar diagnósticos"** (seção "Diagnósticos"; `telemetry.switch` em
   `apps/agent/src/shared/locales/pt-BR.json`, PR #156, brief Revision 4, `observability-tiers`) vem **ligada**. Só existe
   em instalador que inclui o #156 (etapa 1). Deixe ligada: é ele que alimenta o Grafana para a análise depois. Desligado, o agente não exporta nenhum span.
4. Idioma do jogo: pt-BR (os prints reais são pt-BR: "Grupo", "Nome", "Senha", SCR-05). Gráficos modernos.
5. Abra o Task Manager (Detalhes) e o Gerenciador de Desempenho para a etapa 5.

## 3. As 20 salas (game-name-reading T13–T14, brief critério 3)

Pelo menos 20 salas: ~7 normal, ~7 pesadelo, ~6 inferno; misture PvP e leveling e atividades diferentes
(`mm{atividade}{dificuldade}-{n}`, ADR 017). Em cada sala: o anfitrião cria o jogo à mão (público, sem senha), abre o
painel Grupo (Party) com o nome revelado; em algumas, abra o automap e deixe outro jogador entrar e sair (T13, GNR-06,
GNR-07).

| #   | Sala (nome) | Modo (PvP/Leveling) | Dificuldade (n/m/h) | Ladder / era | Confirmada (sim/não) | Errada (sim/não) | Tempo até confirmar (s) | Notas |
| --- | ----------- | ------------------- | ------------------- | ------------ | -------------------- | ---------------- | ----------------------- | ----- |
| 1   |             |                     |                     |              |                      |                  |                         |       |
| ... |             |                     |                     |              |                      |                  |                         |       |
| 20  |             |                     |                     |              |                      |                  |                         |       |

- **Confirmada** = o site mostra a sala como "Confirmed by the agent" depois que o agente leu o nome gerado e o
  comparou com o nome esperado da sala (AGN-03, GNR-01, GNR-09, FR-27). Cronometre do momento em que o painel Grupo
  mostra o nome até o site mudar. Sala que fica em "aguardando" (o agente recusou ler) conta como **não confirmada**.
- **Errada** = o agente confirmou **outra sala** que não a sua, ou um nome que não é o da sala (GNR-02, INV-06). Qualquer
  uma reprova o critério (meta: **zero**). Uma recusa não é "errada"; ela só baixa a taxa.
- Meta: **≥ 95 % confirmadas** (20 salas → no máximo 1 não confirmada) e **0 erradas** (brief, Revision 3).
- Ladder / era: anote como o jogo mostra; a spec não define um valor fixo, é só contexto para o diagnóstico.
- Para cada sala não confirmada, anote o que o painel mostrava (nome mascarado? painel fechado? modo?). Não tire print
  para o repositório (T15 decide o que vira fixture desenhada).

## 4. Matriz de captura (capture-cascade T13, screen-recognition T12, SCR-07, CAP-10, NFR-03)

Para cada célula, com o agente pareado e a janela do agente visível: anote o **método** que a janela do agente mostra
(`graphics-capture`, `print-window`…), a **tela** que o site mostra (seleção de personagem, em jogo, automap, painel
Grupo) e se o quadro ficou **em branco** ou não. Só nomes de método e de tela, nunca imagens (CAP-10).

| Modo \ condição  | Gráficos modernos, brilho baixo | Gráficos modernos, brilho alto | Gráficos legados (G), brilho baixo | Gráficos legados (G), brilho alto |
| ---------------- | ------------------------------- | ------------------------------ | ---------------------------------- | --------------------------------- |
| Janela           | método / tela / branco?         |                                |                                    |                                   |
| Janela sem borda |                                 |                                |                                    |                                   |
| Tela cheia       |                                 |                                |                                    |                                   |

- Se alguma célula tiver **`print-window` e `graphics-capture` em branco ao mesmo tempo**, avise: é a condição para a
  T14 (`screen-crop`) existir; sem essa célula a T14 é fechada sem construir.
- Resolução: o que o seu monitor permitir; se possível, também 1440p ou 1600×900 (ver etapa 8).

## 5. CPU por 30 minutos (capture-cascade T15, screen-recognition T14, NFR-02, SCR-02, CAP-10)

- Para cada método que funcionou na matriz, uma sessão de **≥ 30 minutos** com o agente pareado, o rastreador ligado e o
  jogo em partida (de preferência com uma sala ativa).
- **Limite (NFR-02): média de CPU do agente < 2 %**, e nenhuma queda de FPS perceptível.
- Medição: Task Manager → Detalhes → `d2rmm-agent.exe` → coluna CPU, anotada a cada 5 min; ou
  `Get-Counter '\Process(d2rmm*)\% Processor Time' -SampleInterval 10 -MaxSamples 180` no PowerShell, que dá 30 min.
  **Divida pelo número de núcleos lógicos** (o contador do PowerShell não normaliza; o Task Manager sim).
- Reporte: método, modo, média, pico, e "FPS: sem queda perceptível" ou onde caiu.
- Atenção: `screen-recognition` T14 pede a CPU "da telemetria do agente". Se o agente exportar CPU (Grafana, com
  "Enviar diagnósticos" ligada), anote **os dois números** (Windows e telemetria); hoje o código não exporta essa métrica
  (veja "Lacunas"), então vale o do Windows e a T14 precisa de emenda do orquestrador antes de ser ticada.

## 6. Tela de seleção em pt-BR (screen-recognition, SCR-05) e remote-config T20

- **SCR-05**: na tela de seleção de personagem do cliente pt-BR (em cada modo da matriz), o site deve mostrar "seleção de
  personagem" e o personagem lido deve bater com a sua conta; o agente nunca deve ler um nome errado ("O" no lugar do
  nome; brief, critério "Character and screen reading"). Anote quantas olhadas deram certo e se algum nome foi lido errado.
  Confira também **no site** que o personagem da sua conta foi **casado** (não só que a leitura não é "O"): a correção do
  "O" depende desse casamento no lado do site.
- **remote-config T20** (RCF-08 e outros, `docs/engineering/remote-config.md`): com o instalador de PR, o orquestrador
  serve na API do par da etapa 1 uma configuração com `cadence.probeEvery` diferente (faixa 60…600, padrão 60) e uma região
  alterada (um dos campos `regions.hudBand`, `regions.automapArea` ou `regions.partyArea`, tabela "Fields and ranges" de
  `docs/engineering/remote-config.md`), com `version` maior. Confirme na janela do agente que a versão e o efeito mudam **sem reiniciar**.
  Depois o orquestrador retira a configuração da API: o agente deve **manter a última boa**. Quem muda o arquivo é o
  orquestrador (PR revisado; `agent-config.json`), não você.

## 7. Dados privados

Nada de captura de tela de jogo no repositório, em issue ou em PR (a imagem fica pública e não se desfaz). Notas, tabelas e
números em texto.

## 8. Opcional: print em 1440p ou 1600×900

Se tiver, guarde **fora do repositório** (`apps/agent/ocr-lab/README.md`: o zip criptografado `real-prints.zip` é por mão
do mantenedor). Não envie; só diga que existe e a resolução.

## 9. Entrega dos resultados

Cole no chat, ou em uma issue do GitHub do projeto, em texto: (a) a tabela das 20 salas preenchida e o total
(confirmadas / 20, erradas); (b) a matriz da etapa 4; (c) CPU média e pico por método; (d) resultado da SCR-05 em pt-BR;
(e) resultado da T20; (f) SHA do instalador. Nenhum anexo de imagem. O orquestrador então ticka T13–T15 e abre os
consertos (R14: fixture desenhada primeiro).

## Lacunas (o que o repositório não responde)

- **Log local do agente**: não há arquivo de log local no código do agente (`apps/agent/src-tauri`). O que existe: a
  linha de diagnóstico da janela do agente (método e tela, lição de 2026-11-19) e os spans exportados com "Enviar
  diagnósticos" ligado. Se a T14 pedia "linhas do log do próprio agente", o que vale é o site ("Confirmed by the agent")
  mais o Grafana. Confirmar com o orquestrador.
- **Telemetria de CPU do agente**: o brief fala de "CPU telemetry", mas nenhum código exporta uma métrica de CPU (só
  `d2r.ocr.*` e spans). Por isso a etapa 5 usa o Windows.
- **`workflow_dispatch` do instalador**: `agent.yml` não tem; só PR ou push (etapa 1).
- **Valor de "ladder / era"**: nenhuma spec define; é nota livre.
