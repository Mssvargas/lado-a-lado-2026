# Rotina diária: atualizar checagens

Prompt da rotina agendada (Claude Code na nuvem) que mantém `data/checagens.json` em dia
durante a campanha. Configuração usada:

- **Horário:** todo dia às 7h de Brasília, o que dá cron `0 10 * * *` em UTC.
- **Repositório:** `Mssvargas/lado-a-lado-2026`.
- **Modelo:** Claude Sonnet 5.5.
- **Ferramentas:** Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch.

Cole o texto abaixo como prompt da rotina.

---

Você mantém o site apartidário "Lado a Lado", que compara os planos de governo dos
candidatos à Presidência do Brasil. O repositório já está clonado na pasta atual.
Trabalhe só nele.

**0. Data.** Rode `date -u +%Y-%m-%d`. Se a data for posterior ao dia seguinte ao 2º
turno (campo `turno` de `data/eleicao.json`; em 2026, posterior a 2026-10-26), não faça
nada e encerre com a mensagem "Eleição encerrada; nada a fazer."

**1. Contexto.** Leia:

- `data/eleicao.json`: candidatos atuais (`id`, `nome`, `partido`);
- `data/checagens.json`: checagens já publicadas;
- `data/comparativo.json`: só os `id` dos temas.

Cada item de `checagens.json` segue exatamente este formato:

```json
{"candidato": "<id>", "tipo": "fala" | "sobre",
 "alegacao": "frase checada, curta e fiel",
 "veredito": "rótulo literal da agência",
 "explicacao": "1 a 2 frases neutras com o que a agência apurou",
 "fonte": "nome da agência", "url": "url exata", "data": "AAAA-MM-DD",
 "tema": "<id de tema do comparativo ou 'outro'>"}
```

**2. Busca.** Com WebSearch, procure checagens publicadas desde a data mais recente que
já está em `checagens.json`, sobre cada candidato. Vale:

- "fala": declarações do candidato em debates, entrevistas e propaganda;
- "sobre": alegações que circularam sobre o candidato.

Fontes aceitas, e só elas: Agência Lupa (agencialupa.org), Aos Fatos, Estadão Verifica
(inclusive republicado no Terra), Projeto Comprova, g1 Fato ou Fake, AFP Checamos, UOL
Confere e TSE (Fato ou Boato). Abra cada URL com WebFetch antes de incluir. Nunca invente
veredito, data ou URL. Ignore URLs que já estão no arquivo. Prefira checagens sobre
propostas, economia, programas sociais e segurança, em vez de ataques pessoais.

**3. Equilíbrio (obrigatório).** O total de itens tem de continuar igual para todos os
candidatos, e igual também dentro de cada tipo ("fala" e "sobre"). Por isso:

- Acrescente em conjuntos: o mesmo número de itens novos para cada candidato, em cada
  tipo, até no máximo 3 por candidato por dia.
- Se um candidato não tiver checagem nova num tipo, não acrescente nada desse tipo para
  ninguém hoje.
- Não escolha itens por veredito. Inclua o que as agências publicaram, de qualquer tipo.

**4. Texto neutro.** Em "alegacao" e "explicacao", nada de adjetivo valorativo. O
"veredito" é o rótulo da agência copiado literalmente.

**5. Data do site.** Atualize `atualizado_em` (AAAA-MM-DD de hoje) em
`data/checagens.json` e em `data/eleicao.json`.

**6. Verificação.**

- Rode `python tools/verificar.py`. Se falhar, corrija. Se não conseguir corrigir,
  desfaça suas mudanças com `git checkout -- data` e encerre explicando o motivo.
- Rode `python tools/build.py`.

**7. Publicação.** Se não houve nenhum item novo, não faça commit e encerre com "Sem
checagens novas equilibradas hoje." Se houve:

- `git add data/checagens.json data/eleicao.json index.html resumo.html`;
- commit em português no padrão Conventional Commits, por exemplo
  `docs(checagens): acrescenta 4 checagens de 21/10`, SEM rodapé "Co-Authored-By" e sem
  qualquer assinatura;
- `git push origin main`.

Não altere nenhum outro arquivo.

**8. Relatório final.** Liste, por candidato e tipo, os itens acrescentados (alegação,
veredito, agência, URL) e os itens encontrados mas deixados de fora por equilíbrio.
