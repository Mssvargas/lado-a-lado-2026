# Como atualizar o site para uma nova eleição

O site separa o que é **permanente** do que muda a cada eleição.

| Permanente (só acrescenta) | Muda a cada eleição |
| --- | --- |
| `data/ideologias.json`: enciclopédia de ideologias | `data/eleicao.json`: ano, candidatos, exemplos |
| `data/eleicoes.json`: todas as eleições desde 1891 | `data/comparativo.json`: propostas tema a tema |
| `data/historico.json`: planos anteriores e promessas | `data/espectro.json`: classificação esquerda–direita |
| `data/planos/`: textos de planos antigos | `data/checagens.json`: checagens da campanha |

O código não tem nome de candidato. Site, servidor e imagem de prévia leem tudo de
`data/eleicao.json`. Funciona com 2 candidatos (2º turno) ou com vários (1º turno).

## Calendário

- **Agosto do ano eleitoral:** as candidaturas registram os planos no TSE. É quando dá
  para começar.
- **Setembro e outubro:** a campanha gera checagens, e elas entram aos poucos.
- **Depois do 1º turno:** se houver 2º turno, reduza `eleicao.json` aos dois finalistas.

## Passo a passo

### 1. Guardar a versão anterior

```bash
git tag eleicao-2026
git push origin eleicao-2026
```

A versão de 2026 continua recuperável no GitHub, na aba Tags.

### 2. Baixar e cadastrar os planos

Os planos ficam no TSE (DivulgaCandContas, ou o pacote `proposta_governo_<ano>_BR.zip`
nos dados abertos). Para cada candidato:

```bash
python tools/add_plano.py plano.pdf --id nome-2030 --candidato "Nome" \
    --partido SIGLA --ano 2030 --titulo "Título do plano" --pdf-url https://...
```

Isso cria `data/planos/nome-2030.json` e coloca o plano na aba "Planos na íntegra".

### 3. Editar `data/eleicao.json`

Para cada candidato, preencha:

- `id`: curto, sem acento;
- `nome`;
- `partido`;
- `numero`: o número de urna;
- `plano`: o título;
- `arquivo`: o JSON criado no passo 2;
- `pdf`: o link do PDF;
- `registro`: frase curta com a data;
- `apelidos`: palavras pelas quais o eleitor se refere ao candidato, sem acento.

Atualize também `ano`, `turno`, `atualizado_em`, `exemplos_checagem` e
`exemplo_espectro`. Os exemplos devem ser equilibrados: o mesmo número para cada
candidato.

**Ordem dos candidatos:** pelo número de urna. É um critério objetivo.

**1º turno com muitos candidatos:** decida um critério objetivo antes de começar, como
"todos com plano registrado" ou "todos com representação no Congresso", e registre o
critério na aba "Como foi feito".

### 4. Gerar o comparativo e a classificação

Esta é a parte que exige leitura dos planos. Abra o Claude Code na pasta do projeto e use
os prompts A e B abaixo. Confira o resultado antes de publicar.

Depois do comparativo, gere `data/resumo.json` com o prompt E. Ele alimenta a página
`resumo.html`, a versão curta para compartilhar no WhatsApp.

### 5. Checagens, histórico e eleições

- `data/checagens.json`: use o prompt C. O número de itens precisa ser igual por
  candidato.
- `data/historico.json`: acrescente os registros dos planos anteriores ligados aos novos
  candidatos (prompt D). No campo `vinculo`, use `candidato_atual` com o `id` do
  candidato.
- `data/eleicoes.json`: acrescente o novo ano com os candidatos. Depois da eleição, inclua
  votos e eleito com os dados do TSE.

- `data/verificacao/`: depois de atualizar as promessas, confira cada uma em fontes
  oficiais com o prompt de `tools/PROMPT_VERIFICACAO.md`, um grupo de levantamentos por
  vez. Ajuste no prompt a data de hoje e qual é o mandato atual.

- `data/entregas/`: para cada governo novo, levante as 8 entregas não prometidas com o
  prompt de `tools/PROMPT_ENTREGAS.md`, um agente por governo.

### 6. Atualizar o Acervo Constitucional

```bash
python tools/acervo.py
```

Baixa de novo, do Planalto, a Constituição e as leis do acervo, já com as emendas e
alterações mais recentes. Para incluir uma lei, acrescente uma linha na lista `DOCS` de
`tools/acervo.py`, com o link do texto compilado. Revise a contagem de artigos que o
script imprime: um documento com 0 artigos indica mudança no formato da página.

### 7. Conferir, gerar e publicar

```bash
python tools/verificar.py      # confere trechos, páginas, equilíbrio, verificação e acervo
node tools/testar_pagina.js    # confere se a página inicia sem erro
node tools/testar_api.js       # testa a API com a IA simulada
python tools/build.py          # gera index.html
python tools/og.py             # gera a imagem de prévia do link
git add -A
git commit -m "feat: eleição 2030"
git push
```

O GitHub Pages e a Vercel publicam sozinhos depois do push. A análise automática
(`api/checar.js`) também lê `data/eleicao.json` e não precisa de mudança.

---

## Prompts

Cole no Claude Code, trocando os marcadores `<...>`.

### A. Comparativo tema a tema

> Monte `data/comparativo.json` comparando os planos de governo de `<candidatos>` para
> `<ano>`. Use apenas os textos em `data/planos/<id>.json` (formato
> `{"pages":[{"p","t"}]}`), lidos por inteiro. Siga exatamente o formato atual do
> arquivo. São 17 a 18 temas: Impostos e custo de vida; Contas públicas e tamanho do
> Estado; Trabalho e emprego; Pequenos negócios; Segurança pública; Educação; Saúde;
> Programas sociais, cuidado e idosos; Mulheres; Moradia, saneamento e cidades;
> Infraestrutura; Energia; Meio ambiente; Agro, campo e terras; Indústria e tecnologia;
> Instituições; Política externa e defesa; Cultura, esporte e turismo. Cada item tem:
> proposta (até 25 palavras), trecho literal (até 35 palavras), página do PDF, "simples"
> (o que quer dizer, 1 a 2 frases, explicando siglas, sem opinião) e "detalha"
> (sim/parcial/nao). Regras de neutralidade:
>
> - mesmo verbo ("propõe", "prevê") para todos;
> - nenhum adjetivo valorativo;
> - slogans só como nome de programa, entre aspas;
> - ignorar balanço de mandato e críticas ao adversário;
> - se um plano não trata do tema, registrar "O plano não traz proposta específica sobre
>   isto";
> - no fim, rodar `python tools/verificar.py` e corrigir até passar.

### B. Classificação esquerda–direita

> Atualize `data/espectro.json` para o novo `comparativo.json`. Mantenha `categorias`,
> `metodo` e o formato. Para cada item do comparativo, escolha a categoria do Manifesto
> Project (codebook oficial em manifesto-project.wzb.eu), classificando a MEDIDA, não a
> justificativa. Recalcule `perfil`. Em `partidos`, registre para cada partido a
> autodeclaração do estatuto ou programa (citação literal com URL) e escalas acadêmicas
> de especialistas, com valor, escala, ano e URL. Nunca invente valor. Defina `lado`
> pela escala mais recente. Refaça o quadro `liberdade_expressao` com as mesmas quatro
> perguntas para todos, só com trechos literais. Liste os 10 casos mais duvidosos.

### C. Checagens

> Monte `data/checagens.json` com checagens de `<ano>` publicadas por agências
> reconhecidas: Lupa, Aos Fatos, Estadão Verifica, Comprova, g1 Fato ou Fake, AFP
> Checamos, UOL Confere, TSE Fato ou Boato. Separe falas dos candidatos e alegações
> sobre eles, com o mesmo número por candidato e em cada tipo. Inclua vereditos de todo
> tipo. Abra cada URL antes de incluir. O veredito vai literal, como a agência publicou.

### D. Histórico de promessas

> Acrescente a `data/historico.json` os planos anteriores ligados a `<candidatos>`, do
> mesmo candidato ou do mesmo partido, com o vínculo explicado. Para cada governo
> executado, inclua todos os levantamentos jornalísticos independentes de promessas
> cumpridas, parciais e não cumpridas, com números literais da fonte, data, método e
> URL. Sem números, registre só o link. Nunca recalcule nem invente. Atualize os
> indicadores do IBGE (PIB, IPCA, desocupação) até o último ano disponível.

### E. Resumo para WhatsApp

> A partir de `data/comparativo.json`, escreva `data/resumo.json` no formato atual: para
> cada tema e cada candidato, no máximo 2 frases. A primeira começa com "Propõe…" e traz
> as 2 ou 3 propostas centrais do tema; a segunda é opcional e começa com "Quer…" ou
> "Prevê…". Use a mesma extensão para todos: a diferença no total de palavras entre os
> candidatos não pode passar de 15%. Não use opinião, adjetivo valorativo nem informação
> que não esteja no comparativo. No fim, rode `python tools/verificar.py`.
