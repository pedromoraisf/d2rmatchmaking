# D2R Match Making · PRD

Oct 29, 2026 · @Pedro

Revisão de 28 nov 2026: salas avistadas no jogo (FR-33 a FR-36, jornada J6). O contexto e as decisões de desenho estão em [`direction-2026-11.md`](direction-2026-11.md).

Segunda revisão de 28 nov 2026 (replanejamento antes da F3): a lista de salas abertas vira a tela principal (FR-25, FR-26, FR-37), o quick match substitui a página de matchmaking (FR-06, FR-07, FR-12), ladder e era vão para o perfil (FR-02) e as questões das salas avistadas foram fechadas com a opção conservadora. As fases passam a ser sete (F0 a F6).

O D2R Match Making é uma plataforma da comunidade que forma grupos de PvP e de leveling para Diablo II: Resurrected. Ela respeita dificuldade, ladder e era, entrega o nome da partida e confirma a presença de cada jogador por um agente desktop que só lê a tela, sem tocar no jogo.

## Problema e oportunidade

Achar grupo no D2R ainda é trabalho manual:

- **O lobby do jogo é limitado.** A lista mostra no máximo 40 partidas, sem pareamento por nível, ELO ou função no grupo.
- **Os grupos se formam em canais de Discord.** Alguém posta nome e senha e quem vê entra. Não há fila, confirmação nem reputação.
- **Não existe ranking de PvP.** Duelos não deixam histórico confiável.
- **Não há API oficial do D2R.** Qualquer verificação precisa ser feita do lado do jogador.

Não encontramos um site dedicado, no estilo das plataformas de CS, para D2R. O público principal é o de língua inglesa; o português do Brasil é o segundo idioma, para uma comunidade que hoje depende de canais de Discord que rolam rapidamente.

## Usuários e personas

| Persona | O que quer | Como o produto atende |
| --- | --- | --- |
| Duelista | Duelos justos e um ranking que valha alguma coisa | Fila de PvP por dificuldade e ELO, regras GM ou BM, placar com confirmação dupla |
| Farmer de endgame | Grupos cheios para Baal, Chaos, Terror Zone e Heralds | Fila de leveling com nível mínimo, teleportador e BO definidos, runs em sequência |
| Jogador em progressão | Grupo em Normal ou Pesadelo, onde o lobby público é vazio | Dificuldade como filtro fixo e faixa de nível por dificuldade |
| Host / teleportador | Encher a sala rápido e sem digitar o nome a cada run | Sala gerada pela plataforma; próxima run com um botão ou atalho |

## Objetivos e métricas de sucesso

1. **Formar grupos mais rápido que o lobby e o Discord.**
2. **Dar confiança ao que a plataforma mostra:** quem entrou, quem venceu, quem abandona.
3. **Operar com custo de infraestrutura zero no MVP.**
4. **Construir com harness desde o dia 0**, para que o desenvolvimento agêntico seja seguro e consistente.

As metas abaixo são hipóteses iniciais, para calibrar com os dados do beta.

| Métrica | Meta inicial |
| --- | --- |
| Tempo médio da fila até a sala ativa, Inferno | Menos de 3 min |
| Ready checks aceitos por todos | 85% ou mais |
| Salas formadas que chegam ao estado Ativa | 80% ou mais |
| Salas encerradas por queda do agente, do site ou do vínculo | Menos de 5% |
| Taxa de leitura do agente (leituras válidas) | 95% ou mais |
| Placares de PvP que vão para disputa | Menos de 5% |
| Custo mensal de infraestrutura no MVP | R$ 0 |

## Escopo do MVP

**Dentro:**

- Login com Battle.net (OAuth) e cadastro dos personagens do jogador, lidos pelo agente na tela de seleção de personagem.
- Matchmaking de PvP (Duelo 1v1, 2v2, Arena de 6; regras GM ou BM) e de leveling (Baal, Chaos, Cows, Terror Zone, Heralds), sempre filtrado por região do jogo, dificuldade, ladder e era.
- Lista de salas abertas com filtros como tela principal: o jogador cria uma sala ou entra direto numa sala com vaga, sem fila.
- Quick match: um botão na lista de salas que põe o jogador na fila com os filtros da tela e os dados do personagem.
- Ready check com tempo limite e penalidade para quem não responde, só para grupos formados pelo quick match.
- Lobby Room com nome gerado e sem senha, host definido, estados (Formada, Aguardando host, Criada, Ativa) e runs em sequência.
- Experiência completa obrigatória: agente desktop instalado e pareado, conta vinculada à Battle.net e site conectado.
- Presença confirmada pelo agente
- Placar de PvP com confirmação dos dois lados e disputa por print.
- ELO por personagem e dificuldade e ranking raso: PvP por ELO e leveling por runs, um ranking por dificuldade.
- Tela de perfil com os personagens lidos pelo agente, a declaração de ladder e era, o estado do agente e as preferências.
- Salas avistadas no jogo: partidas públicas comuns do D2R, vistas pelo agente de um jogador, listadas junto das salas da plataforma com a origem sempre indicada. Elas enchem a lista enquanto a plataforma tem poucas salas próprias.
- Agente desktop para Windows: pareamento, heartbeat, leitura do nome da partida e do chat, leitura da tela de busca de partidas, atalhos de aceitar, preencher e reportar, e atualização automática.

**Fora do MVP:**

- Discord e bots.
- Perfil completo, conquistas, missões e torneios.
- Trade e comércio de itens.
- Agente para macOS ou Linux.
- Suporte a jogadores de console. O MVP é só para PC; a estratégia de console fica para depois do MVP.
- Gerir partidas de fora da plataforma: uma sala avistada só é listada, sem fila, ready check, host, placar ou ranking.

**Nunca:** leitura ou escrita de memória do jogo, injeção de código, interceptação de rede e automação que confirme ações no jogo pelo jogador.

## Requisitos funcionais

Prioridade: **Must** entra no MVP, **Should** entra se couber antes do beta, **Could** fica para depois.

| ID | Contexto | Requisito | Prioridade |
| --- | --- | --- | --- |
| FR-01 | Identidade | Entrar com Battle.net (OAuth) e manter sessão da plataforma em cookie | Must |
| FR-02 | Identidade | Cadastrar personagens pelo agente, lendo a tela de seleção de personagem (nome, classe, nível, HC e o título, que indica as dificuldades liberadas); ladder e era são declarados pelo jogador na tela de perfil, uma vez por personagem; sem a declaração o personagem não entra em sala nem em fila | Must |
| FR-03 | Agentes | Parear o agente digitando no site um código de 6 dígitos exibido no agente | Must |
| FR-04 | Agentes | Revogar um agente pareado | Must |
| FR-05 | Agentes | Exibir presença do agente: online, jogo aberto, tela atual | Must |
| FR-06 | Matchmaking | Quick match de PvP: entrar na fila pelo botão da lista de salas, com a dificuldade dos filtros da tela, o personagem ativo, o formato e as regras; o jogador continua navegando na lista enquanto a fila procura | Must |
| FR-07 | Matchmaking | Quick match de leveling: entrar na fila pelo botão da lista de salas, com a atividade e a dificuldade dos filtros da tela, o personagem ativo, a função e o nível mínimo; o jogador continua navegando na lista enquanto a fila procura | Must |
| FR-08 | Matchmaking | Parear só jogadores da mesma região do jogo (Américas, Europa ou Ásia), dificuldade, ladder e era; nunca relaxar esses filtros | Must |
| FR-09 | Matchmaking | Bloquear dificuldades não liberadas no personagem e, no leveling, abaixo do nível mínimo da dificuldade | Must |
| FR-10 | Matchmaking | No PvP, ampliar a faixa de ELO conforme o tempo de espera | Must |
| FR-11 | Matchmaking | No leveling, garantir um teleportador e um BO quando houver na fila | Should |
| FR-12 | Matchmaking | Ready check de 1 minuto, só para grupos formados pelo quick match; aceitar pelo site ou pelo atalho do agente | Must |
| FR-13 | Matchmaking | Não responder gera espera de 5 min; recusar não gera penalidade, por ora; os demais voltam ao topo da fila | Must |
| FR-14 | Lobby Room | Criar a sala a partir do grupo formado pelo quick match ou por um jogador na lista de salas (FR-37), com host, nome no padrão `mm{atividade}{dificuldade}-{n}` e senha sempre vazia (partida pública) | Must |
| FR-15 | Lobby Room | Transitar pelos estados Formada, Aguardando host, Criada, Ativa, Encerrada e Expirada | Must |
| FR-16 | Lobby Room | Confirmar presença por observação do agente | Must |
| FR-17 | Lobby Room | Expirar a sala se o host não criar a partida em 3 min | Must |
| FR-18 | Lobby Room | O host abre a próxima run com um botão; o nome da próxima run já fica visível antes, e o grupo é avisado | Must |
| FR-19 | Lobby Room | Registrar o placar de PvP round a round pelas mensagens de morte lidas pelos agentes dos dois lados; o round só conta quando as leituras batem | Must |
| FR-20 | Lobby Room | Resolver divergências numa pipeline: (1) parear os dados dos agentes dos dois lados; (2) se ainda divergir, decisão pela hierarquia da sala, com prints como evidência | Should |
| FR-21 | Lobby Room | Tratar saída de um duelo ativo como derrota por W.O. | Must |
| FR-22 | Ranking | Calcular ELO por personagem e dificuldade a partir de resultados confirmados | Must |
| FR-23 | Ranking | Mostrar ranking por dificuldade: PvP por ELO e leveling por runs, com a posição de cada personagem do jogador | Must |
| FR-24 | Ranking | Patentes com nome de runa por faixa de ELO | Should |
| FR-25 | Salas ao vivo | Listar as salas abertas como tela principal, para o jogador logado, com filtros por origem, atividade, dificuldade, ladder e core, "só com vaga" e "só as que meu personagem pode entrar", sempre na região do jogador; indicar a compatibilidade do personagem; atualizar ao vivo | Must |
| FR-26 | Salas ao vivo | Entrar direto numa sala com vaga pela lista, sem fila nem ready check; valem FR-08, FR-09 e FR-31. Uma sala de leveling aceita entrada também depois de Ativa, enquanto tiver vaga; uma sala de PvP, só enquanto se forma | Must |
| FR-27 | Agente | Ler o nome da partida no painel Party (revelado pelo jogador) e as mensagens de entrada e saída do chat | Must |
| FR-28 | Agente | Preencher o nome da partida no Game Creator por atalho, sem confirmar | Should |
| FR-29 | Agente | Atualizar-se automaticamente a partir da última release | Must |
| FR-30 | Lobby Room | Moderação hierárquica: o host modera a sala e resolve disputas vendo os prints e o histórico de rounds; na falta dele, o papel passa aos demais membros por ordem de entrada | Should |
| FR-31 | Matchmaking | Entrar na fila, criar uma sala ou entrar numa sala só com agente pareado e online, conta vinculada à Battle.net e site conectado | Must |
| FR-32 | Lobby Room | Se o site ou o agente de um membro perder conexão além da tolerância configurada, o membro sai da sala de forma controlada; se for o host, o papel de host passa ao próximo membro por ordem de entrada | Must |
| FR-33 | Agente | Ler a tela de busca de partidas do D2R: a lista de partidas públicas, os detalhes da partida selecionada e a resposta do jogo quando o jogador tenta entrar numa partida (por exemplo, partida inexistente ou cheia) | Must |
| FR-34 | Salas ao vivo | Avistar partidas comuns do D2R: quando o agente de um jogador que aceitou enviar avistamentos vê, na tela de busca de partidas, uma partida que não é sala da plataforma, envia os metadados lidos (nome da partida, contagem de jogadores, dificuldade quando legível) e o servidor passa a listá-la como sala avistada; um avistamento de dentro da partida só renova uma sala já listada. Nenhum nome de personagem ou BattleTag de terceiros sai do PC | Must |
| FR-35 | Salas ao vivo | Listar as salas avistadas junto das salas da plataforma, sempre com a origem indicada (avistada no jogo, não gerida pela plataforma), com filtro por origem; a linha mostra o nome da partida, a contagem, a dificuldade quando lida, o ladder e o core de quem avistou e o tempo desde o último avistamento; a ação numa sala avistada é copiar o nome para entrar pelo jogo | Must |
| FR-36 | Salas ao vivo | Remover a sala avistada da listagem quando o agente de um jogador que tentou entrar por ela lê que a partida não existe (uma resposta de partida cheia só a marca como cheia), e quando ela fica 10 min sem novo avistamento; depois de 5 min a linha avisa que a partida pode ter acabado. Os dois prazos vêm da configuração remota | Must |
| FR-37 | Salas ao vivo | Criar uma sala aberta pela lista, com atividade, dificuldade e etiquetas predefinidas (sem texto livre); quem cria é o host e a sala fica listada enquanto tiver vaga | Must |

## Requisitos não funcionais

| ID | Categoria | Requisito |
| --- | --- | --- |
| NFR-01 | Latência | Mudança de estado da sala chega ao site em até 2 s após a observação do agente |
| NFR-02 | Desempenho do agente | Menos de 2% de CPU em média e nenhum impacto perceptível no FPS do jogo |
| NFR-03 | Robustez do agente | Funciona em tela cheia, janela sem bordas e janela, sem exigir configuração do jogo |
| NFR-04 | Privacidade | O agente captura só a janela do jogo, processa no PC e envia apenas observações estruturadas; prints só com ação do jogador |
| NFR-05 | LGPD | Consentimento explícito para a captura de tela na instalação; retenção de prints de até 30 dias |
| NFR-06 | Segurança | Token do agente revogável e restrito a heartbeat, observações e push; o agente aceita só dados, nunca comandos |
| NFR-07 | Custo | Infraestrutura em planos gratuitos no MVP (Cloudflare ou Vercel, Render, Neon, GitHub) |
| NFR-08 | Portabilidade | Trocar de provedor de hospedagem muda só a camada de montagem do app |
| NFR-09 | Observabilidade | Traces, métricas e logs em OpenTelemetry desde o dia 0, nos três apps |
| NFR-10 | Qualidade | Pirâmide de testes com testes de mutação no domínio e na aplicação |
| NFR-11 | Harness | Harness enxuto (ADR 029): o CI é o gate de qualidade e os hooks barram só o irreversível; o harness-score é relatório, não gate |
| NFR-12 | Idiomas | Interface nasce em inglês, com i18n para português do Brasil desde o dia 0 (textos em arquivos de tradução, nada fixo no código); leitura do agente com cliente do jogo em inglês e português |
| NFR-13 | Acessibilidade | Site navegável por teclado e com contraste AA |
| NFR-14 | Capacidade | No mínimo 100 jogadores simultâneos na jornada principal, dentro do NFR-01, na infraestrutura gratuita; verificado por teste de carga |

## Jornadas principais

**J1. Duelo ranqueado**

1. Na lista de salas, o jogador filtra PvP e a dificuldade e clica em quick match; informa o formato e as regras.
2. Entra na fila e continua navegando; a faixa de ELO abre com o tempo, a dificuldade nunca.
3. Aceita o ready check no site ou pelo atalho do agente.
4. Recebe o nome da partida; o host cria a partida pública, sem senha, no Game Creator.
5. Os agentes confirmam a presença; a sala fica Ativa e o placar abre.
6. Os dois reportam os rounds; ao confirmar, o ELO daquela dificuldade muda.

**J2. Sessão de leveling**

1. Na lista de salas, o jogador filtra a atividade e a dificuldade e clica em quick match; informa a função e o nível mínimo.
2. A fila monta 8 jogadores com teleportador e BO.
3. Depois do ready check, o teleportador vira host e cria a partida.
4. O grupo entra com o atalho de preencher; o agente confirma cada um.
5. A cada run, o host abre a próxima e o grupo recebe o nome novo.
6. Ao encerrar, as runs somam no ranking daquela dificuldade.

**J3. Entrar pela lista de salas (jornada principal):** o jogador abre a lista, filtra por atividade, dificuldade, ladder e core, vê se o personagem é compatível e entra direto numa sala com vaga, sem ready check; se nenhuma serve, cria a própria sala, que passa a aparecer na lista, ou usa o quick match.

**J4. Instalar o agente:** baixa a última versão pelo site, aceita o termo de captura, lê o código no agente e digita no site logado.

**J5. Disputa de placar:** as leituras divergem e o ELO congela. Primeiro a plataforma pareia os dados dos agentes dos dois lados; se ainda houver diferença, o moderador da sala decide pela hierarquia (o host, depois os demais por ordem de entrada), com prints como evidência.

**J6. Entrar por uma sala avistada**

1. Um jogador com o agente, que aceitou enviar avistamentos, abre a tela de busca de partidas do D2R; o agente lê o que a tela mostra e envia ao servidor.
2. A partida aparece no site na seção de salas avistadas, com a origem indicada e o momento do último avistamento.
3. Outro jogador filtra a lista, copia o nome da sala avistada e entra por ela no jogo.
4. Se o jogo responde que a partida não existe, o agente desse jogador lê a resposta e a sala some da listagem para todos.

## Restrições e premissas

- **Sem API do jogo.** A Blizzard não oferece API pública do D2R. A partida é sempre criada pelo jogador, no próprio jogo.
- **Agente só de leitura de pixels e sinais do sistema.** Nada de memória, injeção ou rede do jogo. A automação de digitação é opcional e nunca confirma a ação.
- **O agente não é aprovado pela Blizzard.** Como ele é obrigatório, precisa ser o mais defensável possível: só leitura e nenhuma automação que confirme ações no jogo.
- **Projeto inteiro open source, sob licença MIT.** Site, API e agente ficam num repositório público, o que permite auditar o agente, usar o GitHub Actions e o Releases de graça e pedir a assinatura gratuita da SignPath Foundation.
- **Projeto da comunidade.** Sem logos ou imagens da Blizzard, com aviso de não afiliação no site.
- **Sinais limitados.** Na tela, só o nome da partida é verificável. O chat mostra o nome do personagem, não a BattleTag, por isso o cadastro de personagens é obrigatório.
- **Partidas sempre públicas, sem senha.** Elas aparecem no Game List e qualquer jogador pode entrar. O agente sinaliza ao grupo quem entrou sem ser membro da sala, e o host pode usar o limite de jogadores e a diferença de nível do Game Creator.
- **Personagem e nível vêm da tela de seleção lida pelo agente; itens são declarados pelo jogador.** Não há como verificar pela API.
- **Planos gratuitos** com limites de banda, computação e retenção.
- **Agente só para Windows**, onde roda o cliente do D2R no PC.

## Riscos de produto

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Pouca gente na fila de Normal e Pesadelo | Espera longa e abandono | Mostrar a espera média por dificuldade; salas ao vivo como alternativa |
| Jogadores resistem a instalar o agente | Menos jogadores entram na plataforma | Código aberto, lista pública do que o agente nunca faz, instalação e pareamento em poucos passos |
| Agente visto como cheat | Rejeição da comunidade | Projeto inteiro open source, com o agente auditável por qualquer um, lista pública do que ele nunca faz, consentimento claro |
| Patch do jogo muda a interface | Leitura do agente quebra | Configuração remota de regiões e textos; alerta pela taxa de leitura |
| Placar falso ou combinado | Ranking sem valor | Confirmação dupla, disputa com print, reputação, ELO só de resultados confirmados |
| Plano gratuito muda ou acaba | Fora do ar ou custo inesperado | Montagem por provedor isolada; Docker e variáveis de ambiente para migrar rápido |
| Confusão com um produto oficial | Problema de marca | Aviso de não afiliação, sem ativos da Blizzard |

## Roadmap

&#91;embedded content: roadmap do MVP · 5 fases e critérios de passagem\]

Desde o replanejamento de 28 nov 2026 as fases são sete: F0 walking skeleton, F1 núcleo de partidas, F2 agente com presença, F3 salas abertas, F4 salas avistadas, F5 competição e F6 beta fechado. A fonte é [`.specs/phases/ROADMAP.md`](../../.specs/phases/ROADMAP.md).

O walking skeleton vem antes de qualquer feature: ele prova a arquitetura, os pipelines, a observabilidade e o harness. A partir da F1, cada fase vira um entregável com specs próprias no fluxo de SDD.

## Questões em aberto

- [x] O ELO é por personagem e dificuldade, no início (decidido).
- [x] Quem modera as disputas? Decidido: moderação hierárquica dentro da sala, em duas etapas: pareamento dos dados dos agentes e, se não resolver, a hierarquia da sala (host, depois os demais por ordem de entrada).
- [x] O beta fechado inclui as três regiões do jogo: Américas, Europa e Ásia (decidido).
- [x] Qual licença open source? Decidido: MIT, aprovada pela OSI, o que mantém a assinatura gratuita da SignPath Foundation.
- [x] Haverá penalidade de reputação por abandono? Decidido: só no PvP; sair de uma sessão de leveling não gera penalidade.
As cinco questões abaixo foram fechadas em 28 nov 2026 com a opção conservadora, apresentada ao mantenedor e adotada sem objeção (AD-183, AD-185); a aprovação do brief da F3 as confirma.

- [x] Salas avistadas: partidas com senha entram na listagem? Não por construção: só é listada a partida vista na tela de busca do jogo; de dentro da partida o agente só renova uma sala já listada. A premissa de que a tela de busca só mostra partidas sem senha é conferida nos prints reais.
- [x] Salas avistadas: quais dados aparecem? O nome da partida (filtrado por uma lista de termos bloqueados), a contagem de jogadores, a dificuldade quando legível e o ladder e o core de quem avistou. Nunca nomes de personagem.
- [x] Salas avistadas: o jogador pode desligar o envio de avistamentos do próprio agente? Sim. O envio começa desligado e o jogador escolhe no termo de captura, sem opção pré-marcada; o interruptor fica no perfil.
- [x] Salas avistadas: qual o prazo sem novo avistamento para a sala sair da lista? Aviso de "pode ter acabado" aos 5 min e saída aos 10 min, ajustáveis pela configuração remota.
- [x] Vídeo do hero com personagens do Diablo II: a restrição "sem logos ou imagens da Blizzard" fica; o hero usa arte própria. Liberar material da Blizzard exigiria uma ADR nova.
- [ ] Disputa de 1v1: como a etapa 2 da hierarquia evita que o host decida a própria disputa? Fica para o kickoff da F5; a opção conservadora é anular o round, sem ELO.
