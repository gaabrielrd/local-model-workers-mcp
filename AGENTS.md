# Instruções do projeto

Projeto: **Local Model Workers MCP** — servidor MCP local (Node.js/TypeScript)
que delega exploração de repositório, busca semântica, consultas de código,
geração de testes, correção de lint e geração de documentação a um modelo
servido por LM Studio numa rede privada confiável. O servidor local permanece a
fronteira de segurança: o modelo remoto nunca escreve no repositório do
desenvolvedor nem aplica patch nele; patches de escrita retornam como diff
unificado não aplicado, e comandos de teste só rodam em cópias temporárias
isoladas (auto-validate) até passarem ou o limite ser atingido.

O setup interativo (`setup`/`init`) escolhe os harnesses por um seletor de
checkboxes (setas + `Space` para alternar, `Enter` confirma, `Ctrl+C` cancela),
com fallback não interativo via flags como `--target all --yes`.

## Estado atual (main)

- Release 2.1.0 publicado (`main` inclui SQLite vector storage, circuit breaker resiliency, multi-repo cross-referencing, context distillation, nova ferramenta `analyze_diff`, suporte a SSE streaming, perfis dinâmicos de configuração, hardware-aware concurrency e containerização Docker).
- Existem exatamente 15 ferramentas MCP (veja `docs/mcp-tools.md`).
- `npm run validate` roda format:check, lint, check:boundaries, typecheck, build
  e testes (368 no total).

## Leia primeiro

1. README.md
2. docs/architecture.md
3. docs/development-process.md
4. docs/testing.md

## Processo obrigatório

1. Entenda a solicitação e os critérios de aceite.
2. Inspecione os arquivos relevantes e os testes existentes.
3. Apresente um plano para mudanças que afetam vários arquivos.
4. Mantenha as alterações dentro do escopo solicitado.
5. Adicione ou atualize testes para mudanças de comportamento.
6. Execute `npm run validate`.
7. Revise o diff final (escopo, segredos e escrita não intencional).
8. Atualize a documentação afetada.

## Arquitetura

- Organize as capacidades do produto em `src/features`.
- Não importe arquivos internos de outra feature; use apenas as exportações
  públicas (`index.ts`).
- Mantenha HTTP, filesystem, Git, processo, clock e persistência atrás de
  serviços/adaptadores.
- Mantenha `shared` neutro em relação ao domínio.
- Não adicione abstrações sem necessidade demonstrada.

## Escopo

- Não expanda o escopo além do solicitado.
- Uma funcionalidade por vez.

## Dependências

- Não adicione dependências sem explicar a necessidade.
- Prefira APIs da plataforma e dependências existentes.
- Nunca faça commit de segredos (tokens, credenciais ou caminhos pessoais).

## APIs e acesso externo

- Chamadas HTTP apenas em serviços/clientes — só o tráfego de inferência
  alcança o LM Studio; conteúdo do repositório nunca é enviado para fora.
- Acesso a repositório é somente leitura, restrito à raiz canônica e
  fail-closed.
- Acesso a filesystem/Git/processo em adaptadores/repositórios.

## Testes

- Toda mudança de comportamento deve considerar testes observáveis de sucesso,
  falha e segurança.
- Use fixtures temporárias; nunca inspecione o repositório real do
  desenvolvedor nem exija LM Studio real em `npm run validate`.

## Documentação

- Toda decisão relevante atualiza a documentação em `docs/` ou um ADR em
  `docs/decisions`.

## Conclusão

Uma tarefa só está concluída quando critérios de aceite, testes, lint,
typecheck, build e documentação estiverem satisfeitos (`npm run validate`
verde) e o diff final for revisado.

# local-model-workers-mcp:start
# Managed by local-model-workers-mcp. Edit only outside these markers.

## Offload repository work to local MCP tools

Use `explore_repository` for goal-directed repository exploration instead of scanning raw files directly.
Use `search_semantic` for natural-language code search.
Use `query_code_graph` for symbol, caller, dependency, and export queries.
Use `summarize_module` for structured file or directory summaries.
Use `propose_tests` when generating or verifying unit tests.

# local-model-workers-mcp:end
