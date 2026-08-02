# PRD — Local Model Workers MCP

**Status:** Aprovado
**Última atualização:** 2026-08-02

## 1. Visão do produto

### Problema

Desenvolvedores que usam Claude Code ou Codex podem querer delegar tarefas de leitura intensiva do repositório e criação de testes a um modelo executado em outra máquina da rede local.

Hoje, essa delegação exige configuração manual, transferência de contexto sem controles consistentes e soluções específicas para cada harness. Isso pode causar:

- envio excessivo ou indevido de arquivos;
- acesso a arquivos fora do projeto;
- respostas sem evidências verificáveis;
- patches que alteram código de produção;
- tarefas sem limite de duração ou concorrência;
- comportamento diferente entre Claude Code e Codex;
- exposição acidental de credenciais e dados sensíveis.

### Proposta de valor

O Local Model Workers MCP permite que Claude Code e Codex executem tarefas remotas isoladas de exploração de repositório e proposta de testes por meio de um modelo servido pelo LM Studio em outra máquina da rede local.

O servidor mantém leitura, permissões, configuração, limites e validação na máquina do desenvolvedor. O modelo remoto recebe apenas o contexto necessário e nunca altera diretamente o repositório.

### Objetivo da primeira versão

Permitir que um desenvolvedor, no macOS, conecte Claude Code e Codex a um servidor MCP local e utilize um modelo remoto do LM Studio para explorar um repositório ou propor testes automatizados, com resultados estruturados, verificáveis e sem escrita direta no projeto.

## 2. Usuários

### Usuário principal

Desenvolvedor individual que:

- trabalha em um repositório local;
- utiliza Claude Code ou Codex;
- possui uma instância do LM Studio sob seu controle;
- conecta as duas máquinas por uma rede local privada;
- deseja usar o modelo remoto para investigação de código e criação assistida de testes;
- mantém sob seu controle a aplicação de patches e a execução de comandos.

### Usuários secundários

Nenhum.

### Usuários não atendidos nesta versão

- equipes que precisam de administração central;
- organizações com múltiplas contas ou perfis;
- operadores de um serviço MCP compartilhado;
- usuários que desejam expor o LM Studio pela internet;
- usuários que precisam de garantia completa de suporte em Linux ou Windows.

## 3. Jornada principal

### Jornada de exploração

1. O desenvolvedor abre um repositório no Claude Code ou Codex.
2. O desenvolvedor solicita, em linguagem natural, a investigação de uma área, comportamento ou problema.
3. O harness chama `explore_repository`, informando o objetivo, a raiz do repositório e, quando necessário, um escopo prioritário.
4. O servidor valida a raiz, as permissões, a configuração e a disponibilidade do LM Studio.
5. O servidor explora o repositório por operações internas somente de leitura.
6. O servidor seleciona e envia ao LM Studio apenas os trechos necessários e permitidos.
7. O modelo remoto produz a análise.
8. O servidor valida as referências e devolve um resultado estruturado.
9. O harness apresenta os achados ao desenvolvedor.
10. O desenvolvedor decide como utilizar a análise.

### Jornada de proposta de testes

1. O desenvolvedor solicita ao Claude Code ou Codex a criação de testes para um comportamento ou área do projeto.
2. O harness chama `propose_tests`, informando o objetivo, a raiz do repositório e um escopo opcional.
3. O servidor verifica a infraestrutura de testes existente.
4. O servidor explora somente os arquivos necessários e permitidos.
5. O LM Studio propõe os testes.
6. O servidor valida os caminhos, o tamanho e os tipos de arquivos afetados.
7. O servidor devolve um patch unificado, premissas e comandos sugeridos.
8. O harness apresenta o patch ao desenvolvedor.
9. O desenvolvedor decide se o harness deve aplicar o patch.
10. O harness, e não o servidor MCP, executa os testes.

## 4. Escopo da primeira versão

| Capacidade                             | Benefício para o usuário                               | Limites                                                                                |
| -------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Exploração remota do repositório       | Delegar investigação de código ao modelo do LM Studio  | Somente leitura, máximo padrão de 15 interações exploratórias e acesso restrito à raiz |
| Proposta de testes                     | Receber testes revisáveis sem permitir escrita remota  | Somente patch; não aplica arquivos, não executa testes e não altera código de produção |
| Diagnóstico de conectividade           | Identificar problemas antes de iniciar uma tarefa      | Não acessa nem analisa o repositório                                                   |
| Configuração consultável               | Entender os parâmetros efetivos da execução            | Valores protegidos são ocultados                                                       |
| Validação de configuração              | Verificar uma mudança antes de gravá-la                | Não altera arquivos                                                                    |
| Atualização controlada da configuração | Ajustar parâmetros do projeto pelo harness             | Exige confirmação explícita e só altera campos permitidos                              |
| Concorrência compartilhada             | Usar Claude Code e Codex sem sobrecarregar o LM Studio | Duas tarefas simultâneas por padrão, somadas entre os processos                        |
| Instalação assistida                   | Configurar os dois harnesses com menos trabalho manual | macOS é a plataforma integralmente validada                                            |

## 5. Requisitos funcionais

### RF-01 — Iniciar o servidor MCP localmente

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** inicialização de um servidor MCP configurado pelo usuário.
- **Entrada:** comando local e parâmetros de inicialização.
- **Comportamento:** o servidor inicia como processo local e se comunica com o harness por `stdio`.
- **Saída:** o harness identifica as seis ferramentas disponíveis.
- **Exceções:** configuração inválida impede a inicialização e produz mensagem sem credenciais.

### RF-02 — Expor somente as ferramentas aprovadas

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** descoberta das ferramentas MCP.
- **Entrada:** solicitação de listagem de ferramentas.
- **Comportamento:** o servidor expõe somente:
    - `explore_repository`;
    - `propose_tests`;
    - `check_health`;
    - `get_config`;
    - `validate_config`;
    - `update_config`.

- **Saída:** contratos estruturados das seis ferramentas.
- **Exceções:** nenhuma ferramenta genérica de execução arbitrária pode ser exposta.

### RF-03 — Verificar a saúde da integração

- **Quem:** desenvolvedor, Claude Code ou Codex.
- **Interface/gatilho:** chamada de `check_health`.
- **Entrada:** nenhuma informação do repositório.
- **Comportamento:** o servidor verifica:
    - validade da configuração;
    - alcance da API do LM Studio;
    - modo de autenticação e, quando houver token configurado, sua aplicação;
    - disponibilidade do modelo padrão;
    - disponibilidade dos modelos autorizados.

- **Saída:** estado de cada verificação e diagnóstico utilizável.
- **Exceções:** tokens, cabeçalhos de autenticação e credenciais nunca aparecem no retorno.

### RF-04 — Receber uma tarefa de exploração

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** chamada de `explore_repository`.
- **Entrada:**
    - objetivo obrigatório em texto;
    - caminho da raiz do repositório;
    - lista opcional de arquivos ou diretórios prioritários.

- **Comportamento:** o servidor valida os dados, cria uma tarefa independente e inicia a exploração.
- **Saída:** identificador da tarefa e resultado estruturado.
- **Exceções:** objetivo vazio, raiz inexistente ou escopo fora da raiz produz estado `failed`.

### RF-05 — Explorar o repositório somente por leitura

- **Quem:** trabalhador remoto controlado pelo servidor.
- **Interface/gatilho:** necessidade de obter contexto para uma tarefa.
- **Entrada:** pedidos internos para listar diretórios, buscar texto ou ler trechos.
- **Comportamento:** o servidor executa somente essas três categorias de operação.
- **Saída:** conteúdo permitido e limitado ao orçamento de contexto.
- **Exceções:** pedidos de escrita, execução de comandos ou acesso fora da raiz são rejeitados.

### RF-06 — Limitar as interações exploratórias

- **Quem:** servidor MCP.
- **Interface/gatilho:** cada solicitação interna de leitura feita durante a tarefa.
- **Entrada:** contador de interações da tarefa.
- **Comportamento:** o servidor permite no máximo 15 interações por padrão.
- **Saída:** a tarefa continua ou é encerrada com indicação de limite.
- **Exceções:** o valor pode ser alterado pela configuração editável, sem superar o limite administrativo.

### RF-07 — Devolver uma exploração estruturada

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** conclusão de `explore_repository`.
- **Entrada:** análise produzida pelo modelo e evidências coletadas.
- **Comportamento:** o servidor organiza e valida o resultado.
- **Saída:**
    - resumo;
    - arquivos relevantes;
    - evidências com caminho e linhas;
    - riscos;
    - próximos passos;
    - arquivos analisados;
    - arquivos relevantes não lidos;
    - limitações;
    - possível impacto das limitações.

- **Exceções:** uma referência inexistente não pode ser apresentada como evidência válida.

### RF-08 — Receber uma tarefa de proposta de testes

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** chamada de `propose_tests`.
- **Entrada:**
    - objetivo obrigatório;
    - raiz do repositório;
    - escopo opcional.

- **Comportamento:** o servidor verifica a infraestrutura de testes, explora o contexto e solicita a proposta ao LM Studio.
- **Saída:** patch ou diagnóstico estruturado.
- **Exceções:** sem infraestrutura de testes utilizável, o resultado será `blocked` e não conterá patch.

### RF-09 — Propor testes sem alterar o projeto

- **Quem:** servidor MCP.
- **Interface/gatilho:** conclusão da geração dos testes.
- **Entrada:** proposta gerada pelo modelo.
- **Comportamento:** o servidor converte ou valida a proposta como patch unificado.
- **Saída:**
    - patch unificado;
    - resumo dos testes;
    - arquivos afetados;
    - premissas;
    - comandos sugeridos para execução.

- **Exceções:** o servidor não aplica o patch e não executa os comandos.

### RF-10 — Restringir os arquivos do patch

- **Quem:** servidor MCP.
- **Interface/gatilho:** validação do patch gerado.
- **Entrada:** caminhos e conteúdo do patch.
- **Comportamento:** o servidor aceita alterações somente em:
    - arquivos de teste;
    - fixtures;
    - mocks;
    - configurações usadas exclusivamente por testes.

- **Saída:** patch validado ou diagnóstico de bloqueio.
- **Exceções:** quando um arquivo não puder ser classificado com segurança como permitido, a tarefa será `blocked`.

### RF-11 — Bloquear alterações em código de produção

- **Quem:** servidor MCP.
- **Interface/gatilho:** patch que inclui código de produção.
- **Entrada:** caminhos e trechos propostos.
- **Comportamento:** o servidor remove o patch da resposta aplicável e registra a necessidade como recomendação.
- **Saída:** resultado `blocked` ou resultado concluído sem a alteração proibida, conforme a dependência do teste.
- **Exceções:** nenhuma alteração de produção pode ser marcada como aplicável.

### RF-12 — Respeitar os limites do patch

- **Quem:** servidor MCP.
- **Interface/gatilho:** validação da proposta.
- **Entrada:** quantidade de arquivos e linhas modificadas.
- **Comportamento:** o servidor aceita no máximo 10 arquivos e 1.000 linhas adicionadas ou modificadas por tarefa.
- **Saída:** patch validado.
- **Exceções:** quando exceder qualquer limite, o servidor devolve um plano de divisão e não entrega patch truncado.

### RF-13 — Tratar ausência de framework de testes

- **Quem:** servidor MCP.
- **Interface/gatilho:** `propose_tests` em um projeto sem infraestrutura utilizável.
- **Entrada:** estrutura e arquivos do projeto.
- **Comportamento:** o servidor identifica a ausência e descreve opções compatíveis.
- **Saída:** estado `blocked`, diagnóstico e instruções sugeridas.
- **Exceções:** nenhuma dependência pode ser instalada ou atualizada pelo servidor.

### RF-14 — Manter tarefas independentes

- **Quem:** servidor MCP.
- **Interface/gatilho:** criação de qualquer tarefa.
- **Entrada:** dados da chamada atual.
- **Comportamento:** cada tarefa recebe contexto, limites, cancelamento e resultado próprios.
- **Saída:** identificador único.
- **Exceções:** nenhuma memória de conteúdo pode ser reaproveitada entre tarefas.

### RF-15 — Processar tarefas concorrentes

- **Quem:** Claude Code e Codex.
- **Interface/gatilho:** chamadas simultâneas.
- **Entrada:** múltiplas tarefas.
- **Comportamento:** o servidor permite duas tarefas em processamento por padrão, considerando todos os processos MCP locais.
- **Saída:** tarefas aceitas ou colocadas em fila.
- **Exceções:** o limite configurado nunca pode superar o máximo administrativo.

### RF-16 — Controlar a fila

- **Quem:** servidor MCP.
- **Interface/gatilho:** recebimento de uma tarefa quando o limite de concorrência está ocupado.
- **Entrada:** tarefa excedente.
- **Comportamento:** o servidor coloca a tarefa em fila por no máximo cinco minutos.
- **Saída:** início do processamento ou estado `timed_out`.
- **Exceções:** o tempo de processamento não começa enquanto a tarefa estiver na fila.

### RF-17 — Limitar o tempo de processamento

- **Quem:** servidor MCP.
- **Interface/gatilho:** início efetivo do processamento.
- **Entrada:** relógio da tarefa.
- **Comportamento:** o servidor permite até dez minutos por padrão.
- **Saída:** resultado ou estado `timed_out`.
- **Exceções:** o limite é configurável dentro do máximo administrativo.

### RF-18 — Cancelar uma tarefa

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** cancelamento da chamada ou encerramento da conexão.
- **Entrada:** sinal de cancelamento.
- **Comportamento:** o servidor interrompe leituras e chamadas ao LM Studio assim que tecnicamente possível.
- **Saída:** estado `cancelled`.
- **Exceções:** um resultado parcial pode aparecer somente como diagnóstico marcado como não concluído.

### RF-19 — Repetir uma falha transitória

- **Quem:** servidor MCP.
- **Interface/gatilho:** falha transitória ou tempo limite da primeira chamada ao LM Studio.
- **Entrada:** erro da API.
- **Comportamento:** o servidor realiza uma nova tentativa por padrão.
- **Saída:** resultado da segunda tentativa ou erro estruturado.
- **Exceções:** não há repetição indefinida.

### RF-20 — Informar progresso

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** harness com suporte a notificações de progresso.
- **Entrada:** mudança de etapa.
- **Comportamento:** o servidor informa:
    - `queued`;
    - `exploring`;
    - `consulting_model`;
    - `preparing_result`.

- **Saída:** atualização de progresso.
- **Exceções:** a ausência de suporte do harness não impede o resultado final.

### RF-21 — Selecionar o modelo

- **Quem:** Claude Code ou Codex.
- **Interface/gatilho:** chamada de uma tarefa.
- **Entrada:** modelo opcional.
- **Comportamento:** sem modelo informado, o servidor usa o modelo padrão; com modelo informado, valida a lista autorizada.
- **Saída:** tarefa associada ao modelo escolhido.
- **Exceções:** modelo não autorizado ou indisponível produz erro; o servidor não substitui o modelo silenciosamente.

### RF-22 — Consultar a configuração efetiva

- **Quem:** desenvolvedor, Claude Code ou Codex.
- **Interface/gatilho:** chamada de `get_config`.
- **Entrada:** raiz opcional do projeto.
- **Comportamento:** o servidor combina configuração global, configuração do projeto e limites protegidos.
- **Saída:** configuração efetiva, revisão e indicação da origem de cada valor.
- **Exceções:** tokens, credenciais e valores secretos são ocultados.

### RF-23 — Validar uma configuração proposta

- **Quem:** desenvolvedor, Claude Code ou Codex.
- **Interface/gatilho:** chamada de `validate_config`.
- **Entrada:** alterações propostas e revisão esperada.
- **Comportamento:** o servidor verifica tipos, faixas, campos permitidos e conflitos.
- **Saída:** configuração válida ou lista de erros.
- **Exceções:** nenhuma alteração é gravada.

### RF-24 — Atualizar a configuração do projeto

- **Quem:** desenvolvedor por meio do Claude Code ou Codex.
- **Interface/gatilho:** chamada confirmada de `update_config`.
- **Entrada:** alterações permitidas, revisão esperada e confirmação explícita do harness.
- **Comportamento:** o servidor valida e grava a configuração do projeto de forma atômica.
- **Saída:**
    - campos alterados;
    - valores anteriores;
    - valores novos;
    - nova revisão.

- **Exceções:**
    - sem confirmação, nada é gravado;
    - revisão divergente produz conflito;
    - campos protegidos são rejeitados;
    - configuração inválida não substitui a atual.

### RF-25 — Preservar tarefas em andamento durante mudanças

- **Quem:** servidor MCP.
- **Interface/gatilho:** atualização de configuração enquanto existem tarefas ativas.
- **Entrada:** nova revisão.
- **Comportamento:** tarefas em andamento continuam usando a revisão com que começaram.
- **Saída:** novas tarefas usam a nova revisão.
- **Exceções:** nenhuma tarefa ativa pode mudar de limite ou modelo durante a execução.

### RF-26 — Detectar mudanças no repositório

- **Quem:** servidor MCP.
- **Interface/gatilho:** conclusão de uma tarefa que utilizou arquivos do projeto.
- **Entrada:** identificação do conteúdo lido e estado atual dos arquivos.
- **Comportamento:** o servidor compara os arquivos usados com sua versão atual.
- **Saída:** resultado normal ou lista de arquivos alterados.
- **Exceções:** quando um arquivo usado mudou, o estado será `blocked` e o patch não será apresentado como aplicável.

### RF-27 — Produzir um contrato de resposta uniforme

- **Quem:** todas as ferramentas MCP.
- **Interface/gatilho:** conclusão, bloqueio, falha, cancelamento ou tempo limite.
- **Entrada:** estado da operação.
- **Comportamento:** o servidor monta uma resposta estruturada.
- **Saída:**
    - `task_id`;
    - `status`;
    - `model`;
    - `config_revision`;
    - resultado ou diagnóstico;
    - evidências;
    - limitações;
    - código de erro, quando aplicável.

- **Exceções:** campos não aplicáveis devem ser omitidos ou marcados explicitamente como não aplicáveis, sem conteúdo inventado.

### RF-28 — Gerar configurações dos harnesses

- **Quem:** desenvolvedor.
- **Interface/gatilho:** comando local de instalação ou configuração.
- **Entrada:** escolha de Claude Code, Codex ou ambos.
- **Comportamento:** o assistente gera a configuração adequada para cada harness.
- **Saída:** arquivos ou trechos de configuração prontos para uso.
- **Exceções:** uma configuração existente não pode ser sobrescrita sem confirmação explícita.

### RF-29 — Manter logs operacionais

- **Quem:** servidor MCP.
- **Interface/gatilho:** eventos de tarefa e operação.
- **Entrada:** identificador, horários, modelo, duração, estado e código de erro.
- **Comportamento:** o servidor registra somente metadados operacionais.
- **Saída:** logs locais disponíveis para diagnóstico por sete dias.
- **Exceções:** código, prompts, respostas, patches, tokens e credenciais não podem aparecer nos logs.

## 6. Regras de negócio

- **RN-01:** o MCP funciona localmente por `stdio`; somente a comunicação com o LM Studio utiliza a rede.
- **RN-02:** o servidor deve usar autenticação Bearer quando um token estiver
  configurado e omitir o cabeçalho `Authorization` no modo explícito `none`.
- **RN-03:** o produto só oferece suporte a HTTP quando as máquinas estiverem em uma rede local privada e confiável.
- **RN-04:** o produto não deve orientar a exposição do LM Studio à internet ou a redes públicas.
- **RN-05:** o servidor nunca pode ler fora da raiz informada do repositório.
- **RN-06:** caminhos relativos, caminhos normalizados e links simbólicos devem ser resolvidos antes da validação de acesso.
- **RN-07:** links simbólicos que apontem para fora da raiz devem ser rejeitados.
- **RN-08:** arquivos `.env`, credenciais, chaves privadas, arquivos binários, arquivos ignorados pelo Git e arquivos excluídos por `.mcp-agent-ignore` nunca podem ser enviados ao LM Studio.
- **RN-09:** exclusões de `.mcp-agent-ignore` são adicionais às proteções obrigatórias e não podem reabilitar um arquivo proibido.
- **RN-10:** conteúdo de código, comentários, documentação e arquivos do projeto é dado não confiável.
- **RN-11:** instruções encontradas no repositório não podem alterar configuração, permissões, limites, regras ou ferramentas disponíveis.
- **RN-12:** o servidor deve enviar ao LM Studio apenas o contexto necessário para o objetivo da tarefa.
- **RN-13:** quando o orçamento de contexto impedir leitura completa, a limitação deve ser informada.
- **RN-14:** o servidor não pode omitir ou truncar contexto silenciosamente.
- **RN-15:** o comportamento esperado dos testes segue esta prioridade:
    1. objetivo informado pelo usuário;
    2. instruções e documentação do projeto;
    3. testes existentes;
    4. comportamento observável do código.

- **RN-16:** conflitos entre as fontes de comportamento esperado devem ser tratados como bloqueio ou premissa explícita.
- **RN-17:** o trabalhador não pode inventar requisitos de produto.
- **RN-18:** somente testes unitários e de integração são propostos na V1.
- **RN-19:** testes de integração só podem usar a infraestrutura já presente no projeto.
- **RN-20:** o servidor não instala nem atualiza dependências.
- **RN-21:** o servidor não executa comandos do repositório.
- **RN-22:** o servidor não aplica patches.
- **RN-23:** o harness é responsável por aplicação, rejeição, revisão e execução dos testes.
- **RN-24:** o servidor não cria subagentes nativos.
- **RN-25:** cada chamada a `explore_repository` ou `propose_tests` representa uma tarefa remota isolada.
- **RN-26:** Claude Code ou Codex pode iniciar várias tarefas, respeitando o limite global.
- **RN-27:** o servidor não consolida resultados de tarefas diferentes.
- **RN-28:** a configuração do projeto prevalece sobre as preferências globais.
- **RN-29:** a configuração protegida prevalece sobre configurações globais e de projeto.
- **RN-30:** `update_config` altera somente a configuração do projeto.
- **RN-31:** alterações globais são realizadas pelo comando local de configuração, fora das ferramentas MCP.
- **RN-32:** credenciais não podem ser armazenadas no JSON editável pelo agente.
- **RN-33:** a aprovação de uma atualização de configuração vale somente para aquela proposta e revisão.
- **RN-34:** respostas parciais nunca podem ser apresentadas como concluídas.
- **RN-35:** os estados permitidos são `completed`, `blocked`, `failed`, `cancelled` e `timed_out`.
- **RN-36:** nomes de ferramentas, campos, estados e códigos de erro são escritos em inglês.
- **RN-37:** resumos e explicações acompanham o idioma usado no pedido.
- **RN-38:** o servidor não mantém memória de conteúdo entre tarefas.
- **RN-39:** prompts, respostas, patches e cópias do repositório não são persistidos.
- **RN-40:** o prazo de retenção dos logs operacionais é de sete dias.

## 7. Dados e arquivos

| Dado/arquivo                  | Formato                                              | Origem                                      | Obrigatório                                | Armazenamento e prazo               | Alteração/exclusão                 | Sensível                                       |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ----------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Objetivo da tarefa            | Texto                                                | Harness                                     | Sim                                        | Somente durante a tarefa            | Descartado ao final                | Pode conter contexto do projeto; não persistir |
| Raiz do repositório           | Caminho local                                        | Harness                                     | Sim                                        | Somente durante a tarefa            | Descartada ao final                | Sim, por revelar estrutura local               |
| Escopo prioritário            | Lista de caminhos                                    | Harness                                     | Não                                        | Somente durante a tarefa            | Descartado ao final                | Potencialmente                                 |
| Trechos do repositório        | Texto                                                | Arquivos locais                             | Conforme necessidade                       | Memória temporária da tarefa        | Descartados ao final               | Potencialmente sensíveis                       |
| Evidências                    | Caminho, linhas e descrição                          | Servidor                                    | Sim para achados verificáveis              | Somente no retorno                  | Não persistidas                    | Podem revelar nomes de arquivos                |
| Patch proposto                | Diff unificado                                       | LM Studio e validação local                 | Apenas em resultado aplicável              | Somente no retorno                  | Não persistido                     | Sim, contém código                             |
| Configuração protegida        | Variáveis de ambiente ou configuração administrativa | Desenvolvedor                               | Sim                                        | Ambiente local                      | Alteração fora do MCP              | Sim                                            |
| Preferências globais          | JSON                                                 | Comando local de configuração               | Não                                        | Máquina local, sem prazo automático | Alteradas pelo comando local       | Não deve conter credenciais                    |
| Configuração do projeto       | JSON                                                 | Desenvolvedor ou `update_config` confirmado | Não                                        | Projeto local                       | Gravação atômica e revisionada     | Não deve conter credenciais                    |
| Regras adicionais de exclusão | `.mcp-agent-ignore`                                  | Repositório                                 | Não                                        | Repositório                         | Alteração pelo desenvolvedor       | Não                                            |
| Configuração do Claude Code   | Formato nativo do harness                            | Assistente local                            | Conforme uso                               | Máquina ou projeto                  | Nunca sobrescrever silenciosamente | Pode referenciar variáveis secretas            |
| Configuração do Codex         | Formato nativo do harness                            | Assistente local                            | Conforme uso                               | Máquina ou projeto                  | Nunca sobrescrever silenciosamente | Pode referenciar variáveis secretas            |
| Logs operacionais             | Registros estruturados sem conteúdo                  | Servidor                                    | Sim                                        | Máquina local por sete dias         | Exclusão automática após o prazo   | Não devem conter dados do código               |
| Token do LM Studio            | Segredo                                              | Desenvolvedor                               | Sim quando autenticação estiver habilitada | Ambiente protegido                  | Alteração fora do MCP              | Sim                                            |

## 8. Integrações e dependências

| Integração/dependência              | Finalidade                            | Comportamento em falha                                                                        |
| ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Claude Code                         | Consumir as ferramentas MCP           | O erro é devolvido no contrato MCP sem interromper o repositório                              |
| Codex                               | Consumir as ferramentas MCP           | O erro é devolvido no contrato MCP sem interromper o repositório                              |
| LM Studio                           | Executar o modelo remoto              | Uma nova tentativa em falha transitória; depois, estado `failed` ou `timed_out`               |
| API HTTP compatível do LM Studio    | Transporte da inferência              | Erro estruturado para indisponibilidade, autenticação ou modelo ausente                       |
| Git                                 | Identificar arquivos ignorados        | Se a informação necessária não puder ser obtida com segurança, o arquivo não deve ser enviado |
| Sistema de arquivos local           | Ler repositório e configuração        | Falhas de acesso produzem erro sem ampliar permissões                                         |
| Infraestrutura de testes do projeto | Definir formatos e comandos sugeridos | Sem infraestrutura utilizável, `propose_tests` retorna `blocked`                              |
| Rede local privada                  | Transportar trechos até o LM Studio   | Falha de rede segue a política de tentativa e erro estruturado                                |

## 9. Interface e estados

A V1 não possui interface gráfica própria. A interação acontece pelas ferramentas MCP e pelo comando local de instalação e configuração.

| Interface ou componente | Carregando                      | Vazio                                              | Sucesso                              | Erro                        | Sem permissão                            | Navegação por teclado                    |
| ----------------------- | ------------------------------- | -------------------------------------------------- | ------------------------------------ | --------------------------- | ---------------------------------------- | ---------------------------------------- |
| `explore_repository`    | Progresso nas etapas suportadas | Objetivo ou raiz ausente gera validação            | Relatório estruturado com evidências | Estado e código de erro     | Acesso fora da raiz é rejeitado          | Controlada pelo harness                  |
| `propose_tests`         | Progresso nas etapas suportadas | Sem infraestrutura gera `blocked`                  | Patch e informações de execução      | Estado e diagnóstico        | Arquivo não permitido bloqueia o patch   | Controlada pelo harness                  |
| `check_health`          | Indicação de verificação        | Não se aplica                                      | Estado de cada dependência           | Diagnóstico sem segredos    | Valores protegidos ocultados             | Controlada pelo harness                  |
| `get_config`            | Não exige progresso             | Sem configuração de projeto mostra valores globais | Configuração efetiva redigida        | Erro de leitura estruturado | Segredos nunca são exibidos              | Controlada pelo harness                  |
| `validate_config`       | Não exige progresso             | Proposta vazia é inválida                          | Lista de mudanças válidas            | Lista de erros              | Campos protegidos são rejeitados         | Controlada pelo harness                  |
| `update_config`         | Aguarda confirmação no harness  | Sem mudanças não grava                             | Nova revisão e diferenças            | Conflito ou validação falha | Sem confirmação não grava                | Controlada pelo harness                  |
| Assistente local        | Indicação textual de etapa      | Nenhum harness selecionado impede conclusão        | Configuração gerada                  | Mensagem com ação corretiva | Alterações existentes exigem confirmação | Deve funcionar integralmente por teclado |

## 10. Plataformas e distribuição

- **Dispositivos e sistemas:** computadores de desenvolvimento.
- **Plataforma oficialmente validada:** macOS.
- **Compatibilidade planejada:** Linux e Windows.
- **Validação em Linux e Windows:** testes automatizados básicos de instalação, inicialização e configuração.
- **Integração completa em Linux e Windows:** não bloqueia o lançamento da V1.
- **Forma de entrega:** comando local instalável.
- **Instalação:** assistente para Claude Code, Codex ou ambos.
- **Atualização:** manual.
- **Container:** não faz parte da instalação principal.
- **Uso sem conexão:** não se aplica, porque a execução depende da conexão com o LM Studio na rede local.
- **Servidor MCP:** processo local via `stdio`.
- **Inferência:** conexão HTTP com a máquina do LM Studio.
- **HTTPS:** aceito quando fornecido pelo ambiente, mas configuração de proxy e certificados não faz parte da V1.

## 11. Restrições e requisitos de qualidade

- **Acessibilidade da interface:** o assistente local deve ser utilizável por teclado e apresentar mensagens textuais claras. A acessibilidade visual do Claude Code e Codex pertence aos respectivos harnesses.
- **Idiomas:** contratos técnicos em inglês; explicações no idioma do pedido; documentação inicial em inglês, com exemplos em português.
- **Desempenho:** duas tarefas simultâneas por padrão, cinco minutos máximos de fila e dez minutos máximos de processamento.
- **Privacidade:** nenhum conteúdo do repositório, prompt, resposta ou patch é persistido.
- **Acesso:** leitura restrita à raiz e aos arquivos permitidos.
- **Autenticação:** token Bearer opcional para a API do LM Studio; quando
  ausente, o servidor opera explicitamente em modo `none` somente na rede local
  privada e confiável.
- **Portabilidade:** a implementação não deve depender intencionalmente de comportamento exclusivo do macOS quando houver alternativa portável.
- **Responsividade visual:** não se aplica, porque não há interface gráfica própria.
- **Confiabilidade:** gravação de configuração atômica e controle por revisão.
- **Auditabilidade:** toda conclusão relevante deve apontar para evidência existente ou indicar que se trata de premissa.
- **Segurança de rede:** HTTP somente em rede local privada e confiável.
- **Exposição pública:** não suportada.
- **Limite de contexto:** configurável e sempre acompanhado de informação sobre conteúdo não analisado.
- **Retenção:** logs operacionais por sete dias.
- **Segredos:** nunca armazenados em arquivos JSON editáveis pelo agente.
- **Qualidade multiplataforma:** instalação, inicialização e configuração devem possuir testes automatizados básicos em macOS, Linux e Windows.
- **Qualidade por ecossistema:** validação funcional oficial em um projeto Python e um projeto TypeScript.

## 12. Critérios de sucesso

| Indicador                         | Meta                                    | Como medir                                                               | Quando avaliar                                |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| Referências válidas               | 100%                                    | Verificar se cada caminho e linha devolvidos existem na versão analisada | Antes do lançamento e a cada versão           |
| Patches aplicáveis                | Pelo menos 80%                          | Aplicar os patches dos cenários oficiais sem conflito                    | Validação da versão candidata                 |
| Respeito aos arquivos permitidos  | 100%                                    | Inspecionar todos os caminhos modificados                                | Antes do lançamento e em testes automatizados |
| Testes executáveis                | Pelo menos 80% dos patches aplicados    | Executar o comando sugerido pelo harness                                 | Validação da versão candidata                 |
| Respeito aos limites operacionais | 100%                                    | Testar fila, tempo máximo, cancelamento e concorrência                   | Testes automatizados                          |
| Proteção de caminhos              | 100%                                    | Testar caminhos relativos, absolutos e links simbólicos                  | Testes automatizados de segurança             |
| Proteção de arquivos sensíveis    | 100%                                    | Instrumentar a saída enviada ao LM Studio e verificar exclusões          | Testes automatizados de segurança             |
| Confirmação de configuração       | 100%                                    | Tentar atualizar sem aprovação                                           | Testes automatizados                          |
| Ausência de conteúdo nos logs     | 100%                                    | Inspecionar logs produzidos pelos cenários oficiais                      | Antes do lançamento                           |
| Compatibilidade com harnesses     | 100% das ferramentas nos dois harnesses | Executar chamadas no Claude Code e Codex                                 | Validação da versão candidata                 |
| Validação de ecossistemas         | Python e TypeScript concluídos          | Executar exploração e proposta de testes nos dois projetos               | Validação da versão candidata                 |

## 13. Critérios de aceite

- **CA-01:** dado um servidor instalado, quando Claude Code iniciar o processo por `stdio`, então as seis ferramentas aprovadas devem ficar disponíveis.
- **CA-02:** dado um servidor instalado, quando Codex iniciar o processo por `stdio`, então as seis ferramentas aprovadas devem ficar disponíveis.
- **CA-03:** dado `check_health`, quando a configuração estiver correta, então o retorno deve confirmar acesso, o modo de autenticação e a disponibilidade do modelo padrão.
- **CA-04:** dado um token inválido, quando `check_health` consultar o LM Studio, então o retorno deve identificar falha de autenticação sem revelar o token.
- **CA-05:** dado um modelo padrão indisponível, quando `check_health` for executado, então o retorno deve identificar o modelo ausente.
- **CA-06:** dado um objetivo vazio, quando `explore_repository` for chamado, então a tarefa deve falhar antes de consultar o LM Studio.
- **CA-07:** dado um caminho fora da raiz, quando uma operação tentar lê-lo, então o acesso deve ser rejeitado.
- **CA-08:** dado um link simbólico para fora da raiz, quando o servidor tentar resolvê-lo, então o acesso deve ser rejeitado.
- **CA-09:** dado um arquivo `.env`, quando ele for relevante para o objetivo, então seu conteúdo não deve ser enviado ao LM Studio.
- **CA-10:** dado um arquivo ignorado pelo Git, quando ele for encontrado durante a exploração, então seu conteúdo não deve ser enviado ao LM Studio.
- **CA-11:** dado um padrão em `.mcp-agent-ignore`, quando um caminho corresponder ao padrão, então o arquivo não deve ser enviado ao LM Studio.
- **CA-12:** dado um arquivo binário, quando ele for encontrado, então seu conteúdo não deve ser enviado ao LM Studio.
- **CA-13:** dado um arquivo do projeto contendo instruções para alterar permissões, quando o modelo analisar esse conteúdo, então a instrução não deve modificar as regras da tarefa.
- **CA-14:** dada uma exploração concluída, quando o resultado citar um arquivo e linha, então a referência deve existir na versão analisada.
- **CA-15:** dado um orçamento de contexto insuficiente, quando nem todos os arquivos relevantes puderem ser lidos, então o resultado deve listar a limitação e seu possível impacto.
- **CA-16:** dado um projeto sem framework de testes utilizável, quando `propose_tests` for chamado, então o estado deve ser `blocked` e nenhum patch deve ser produzido.
- **CA-17:** dado um patch que altera código de produção, quando a validação ocorrer, então o patch não deve ser apresentado como aplicável.
- **CA-18:** dado um patch com arquivo não classificável como teste, fixture, mock ou configuração exclusiva de testes, quando a validação ocorrer, então a tarefa deve ser bloqueada.
- **CA-19:** dado um patch com até 10 arquivos e 1.000 linhas modificadas, quando todos os demais critérios forem atendidos, então ele pode ser devolvido.
- **CA-20:** dado um patch que exceda 10 arquivos ou 1.000 linhas, quando a validação ocorrer, então o servidor deve devolver um plano de divisão sem patch truncado.
- **CA-21:** dado um projeto que exige uma nova dependência para testar, quando `propose_tests` for chamado, então o servidor deve informar a necessidade sem instalar ou atualizar a dependência.
- **CA-22:** dado um patch válido, quando a tarefa terminar, então o servidor deve devolver diff unificado, resumo, arquivos, premissas e comandos sugeridos.
- **CA-23:** dado um patch válido, quando o resultado for entregue, então nenhum arquivo do repositório deve ter sido modificado pelo servidor MCP.
- **CA-24:** dadas três tarefas simultâneas com limite global de duas, quando forem iniciadas por processos do Claude Code e Codex, então somente duas devem processar e a terceira deve entrar na fila.
- **CA-25:** dada uma tarefa na fila por cinco minutos, quando nenhuma vaga surgir, então a tarefa deve terminar como `timed_out`.
- **CA-26:** dada uma tarefa iniciada, quando dez minutos de processamento forem atingidos, então a tarefa deve terminar como `timed_out`.
- **CA-27:** dada uma chamada cancelada pelo harness, quando o servidor receber o cancelamento, então a tarefa deve terminar como `cancelled`.
- **CA-28:** dada uma falha transitória do LM Studio, quando a primeira chamada falhar, então o servidor deve tentar novamente uma vez.
- **CA-29:** dadas duas falhas consecutivas do LM Studio, quando a segunda ocorrer, então o servidor deve devolver erro estruturado e não marcar resultado parcial como concluído.
- **CA-30:** dado um harness com suporte a progresso, quando a tarefa avançar, então o servidor deve emitir as etapas previstas.
- **CA-31:** dado um modelo solicitado fora da lista autorizada, quando a tarefa for criada, então ela deve falhar sem substituir o modelo.
- **CA-32:** dado um modelo autorizado mas indisponível, quando a tarefa for criada, então ela deve falhar sem usar outro modelo.
- **CA-33:** dada uma chamada de `get_config`, quando a configuração efetiva for devolvida, então credenciais e tokens devem estar ocultos.
- **CA-34:** dada uma configuração inválida, quando `validate_config` for chamado, então os erros devem ser devolvidos sem gravação.
- **CA-35:** dada uma chamada de `update_config` sem aprovação explícita, quando o servidor processá-la, então nenhum arquivo deve ser alterado.
- **CA-36:** dada uma chamada confirmada de `update_config`, quando a revisão esperada for igual à atual, então a gravação deve ser atômica e incrementar a revisão.
- **CA-37:** dada uma revisão esperada desatualizada, quando `update_config` for chamado, então a operação deve falhar por conflito.
- **CA-38:** dada uma tentativa de alterar token, URL do LM Studio, modelos autorizados ou limites administrativos por `update_config`, então a operação deve ser rejeitada.
- **CA-39:** dada uma tarefa em andamento, quando a configuração for atualizada, então a tarefa deve continuar com a revisão original.
- **CA-40:** dado um arquivo usado na geração de um patch, quando ele mudar antes da conclusão, então o resultado deve ser `blocked` e o patch não deve ser apresentado como aplicável.
- **CA-41:** dada uma tarefa concluída, quando sua resposta for entregue, então deve conter estado, identificador, modelo e revisão da configuração.
- **CA-42:** dado um pedido em português, quando a tarefa terminar, então o resumo deve estar em português e os campos técnicos devem permanecer em inglês.
- **CA-43:** dada uma tarefa encerrada, quando uma nova tarefa começar, então nenhum conteúdo da anterior deve ser utilizado como memória.
- **CA-44:** dados os logs de sete dias, quando forem inspecionados, então devem conter apenas metadados operacionais permitidos.
- **CA-45:** dado um log com mais de sete dias, quando a rotina de retenção for executada, então o registro deve ser excluído.
- **CA-46:** dada uma configuração existente do Claude Code ou Codex, quando o assistente local detectar conflito, então deve solicitar confirmação antes de sobrescrever.
- **CA-47:** dada a versão candidata no macOS, quando os cenários oficiais forem executados em Claude Code e Codex, então todas as ferramentas devem funcionar.
- **CA-48:** dados projetos oficiais Python e TypeScript, quando as explorações forem executadas, então 100% das evidências devem apontar para arquivos e linhas existentes.
- **CA-49:** dados os patches dos cenários oficiais, quando forem aplicados, então pelo menos 80% devem ser aplicados sem conflito.
- **CA-50:** dados os patches aplicados dos cenários oficiais, quando os comandos sugeridos forem executados pelo harness, então pelo menos 80% devem iniciar testes executáveis.
- **CA-51:** dados todos os patches dos cenários oficiais, quando seus caminhos forem inspecionados, então 100% devem respeitar os tipos de arquivo permitidos.
- **CA-52:** dadas execuções em Linux e Windows, quando os testes básicos forem realizados, então instalação, inicialização e leitura da configuração devem concluir sem erro bloqueante.

## 14. Não escopo

- criação de subagentes nativos do Claude Code ou Codex;
- orquestração interna de múltiplos trabalhadores;
- consolidação automática de resultados de tarefas diferentes;
- escrita direta no repositório;
- aplicação automática de patches;
- execução de testes ou comandos pelo servidor MCP;
- alteração de código de produção;
- instalação ou atualização de dependências;
- criação de infraestrutura de testes inexistente;
- testes de navegador;
- testes de interface gráfica;
- testes específicos de dispositivos móveis;
- testes contra serviços externos reais;
- administração para equipes;
- múltiplas contas ou perfis;
- serviço MCP compartilhado por vários usuários;
- exposição do LM Studio à internet;
- uso em redes públicas;
- instalação e gestão de proxy reverso;
- gestão de certificados HTTPS;
- container como forma principal de instalação;
- atualizações automáticas;
- interface gráfica própria;
- memória persistente entre tarefas;
- armazenamento de prompts, respostas ou patches;
- garantia formal de qualidade para linguagens além de Python e TypeScript;
- validação integral da combinação Claude Code e Codex em Linux e Windows na V1.

## 15. Decisões e motivos

| Decisão                  | Escolha                                        | Motivo                                                | Alternativa descartada                                                                  |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Harnesses                | Claude Code e Codex na V1                      | Evitar dependência de um único ambiente               | Validar somente um harness reduziria o trabalho, mas não atenderia ao objetivo aprovado |
| Transporte MCP           | Processo local por `stdio`                     | Menor superfície de rede e suporte nos dois harnesses | MCP HTTP local adicionaria porta e configuração sem benefício necessário                |
| Inferência               | LM Studio em outra máquina                     | Aproveitar recursos remotos na rede local             | Executar o modelo na mesma máquina limitaria o cenário desejado                         |
| Coordenação              | Harness chama ferramentas explícitas           | Maior portabilidade e controle                        | Orquestração interna aumentaria complexidade                                            |
| Conceito de execução     | Tarefas remotas isoladas                       | Comportamento consistente nos dois harnesses          | Subagentes nativos possuem contratos diferentes                                         |
| Ferramentas              | Seis ferramentas específicas                   | Permissões e resultados verificáveis                  | Ferramenta genérica permitiria instruções ambíguas                                      |
| Escrita                  | Somente patch proposto                         | Manter controle no harness                            | Escrita direta exigiria permissões, rollback e auditoria adicionais                     |
| Testes                   | Execução pelo harness                          | Aproveitar ambiente e aprovações já existentes        | Execução pelo MCP duplicaria responsabilidades                                          |
| Exploração               | Ciclo limitado de leitura                      | Permitir descoberta progressiva                       | Seleção única de arquivos pode perder relações                                          |
| Concorrência             | Duas tarefas globais                           | Proteger a capacidade do LM Studio                    | Concorrência ilimitada poderia sobrecarregar a máquina                                  |
| Falha transitória        | Uma nova tentativa                             | Tolerar indisponibilidade breve                       | Falha imediata seria menos resiliente                                                   |
| Configuração             | Protegida, global e por projeto                | Separar segurança de preferências                     | Um único arquivo editável exporia parâmetros administrativos                            |
| Atualização pelo agente  | Confirmação explícita                          | Evitar alterações induzidas pelo repositório          | Aplicação automática teria maior risco                                                  |
| Privacidade              | Sem persistência de conteúdo                   | Reduzir exposição do código                           | Histórico completo ajudaria depuração, mas ampliaria risco                              |
| Logs                     | Metadados por sete dias                        | Permitir diagnóstico básico                           | Logs de conteúdo violariam a política de privacidade                                    |
| Rede                     | HTTP em rede privada, com autenticação opcional | Compatibilidade com `lms` e menor custo de implantação | HTTPS obrigatório exigiria gestão de certificados                                       |
| Plataforma               | macOS validado oficialmente                    | Corresponder ao ambiente inicial do usuário           | Três plataformas completas aumentariam a matriz de lançamento                           |
| Portabilidade            | Testes básicos em Linux e Windows              | Evitar dependência exclusiva do macOS                 | Ignorar os outros sistemas dificultaria expansão futura                                 |
| Linguagens               | Genérico, com validação em Python e TypeScript | Permitir uso amplo com critérios mensuráveis          | Suporte formal universal não seria verificável na V1                                    |
| Testes suportados        | Unitários e integração existente               | Escopo útil e controlável                             | Interface, mobile e serviços reais exigiriam infraestrutura adicional                   |
| Limite de patch          | 10 arquivos e 1.000 linhas                     | Manter o resultado revisável                          | Patch sem limite aumentaria risco e custo de revisão                                    |
| Mudança durante a tarefa | Bloquear resultado aplicável                   | Evitar patch gerado sobre versão antiga               | Aplicar mesmo assim poderia produzir conflito ou comportamento incorreto                |

## 16. Decisões em aberto

Nenhuma.
