# Instruções do projeto

Projeto: **Local Model Workers MCP** — servidor MCP local (Node.js/TypeScript)
que delega exploração de repositório, busca semântica, consultas de código e
geração de testes a um modelo servido por LM Studio numa rede privada
confiável. O servidor local permanece a fronteira de segurança: o modelo remoto
nunca escreve no repositório, aplica patch nem executa comandos.

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
