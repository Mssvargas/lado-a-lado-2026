# Lado a Lado 2026

Site apartidário que compara os planos de governo oficiais de Lula (PT, 13) e Flávio
Bolsonaro (PL, 22) para a eleição presidencial de 2026. Cada proposta aparece em
linguagem simples, com o trecho literal e a página do PDF.

## O que tem

- **Comparar propostas**: 18 temas, com as propostas de cada plano lado a lado ou em
  tabela, e a coluna "Em palavras simples".
- **Checar uma fala**: busca a frase nos dois planos completos e nas checagens
  reunidas. Com o servidor configurado, faz também a análise automática com busca ao
  vivo em agências de checagem e na imprensa.
- **Checagens publicadas**: 12 por candidato (7 falas e 5 alegações), de agências de
  checagem reconhecidas.
- **Planos na íntegra**: o texto dos dois planos, página por página, com busca.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `index.html` | O site, gerado por `tools/build.py`. Não editar à mão. |
| `tools/template.html` | Fonte do site (HTML, CSS e JS). |
| `data/comparativo.json` | Temas e propostas, com trecho literal e página. |
| `data/checagens.json` | Checagens de agências e reportagens comparativas. |
| `data/plano-*.json` | Texto integral dos planos, por página do PDF. |
| `api/checar.js` | Função de servidor (Vercel) da análise automática. |
| `og.png` | Prévia do link (WhatsApp e redes), gerada por `tools/og.py`. |

Para mudar conteúdo, edite `data/*.json` ou `tools/template.html` e rode:

```bash
python tools/build.py
```

## Hospedagem

- **GitHub Pages** serve o site estático. A análise automática fica escondida, porque
  não há servidor.
- **Vercel** serve o site e a função `api/checar.js`. Importe o repositório na Vercel e
  configure as variáveis de ambiente abaixo. O site detecta a função sozinho e mostra a
  análise.

| Variável | Para quê |
|---|---|
| `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | IA gratuita. Basta uma, e a fila segue nessa ordem. |
| `TAVILY_API_KEY` | Busca ao vivo em agências de checagem e imprensa. |
| `WEB_DOMINIOS` | Opcional: domínios extras para a busca, separados por vírgula. |

`GET /api/checar` mostra o que está configurado, sem gastar cota.

## Regras de neutralidade

- Mesmo formato, mesmos verbos e mesmas cores para os dois candidatos. A ordem é a do
  número de urna.
- Só entra o que o plano propõe fazer. Ficam de fora o balanço de mandato e as críticas
  ao adversário.
- Todo trecho citado é conferido contra o texto da página indicada. Na análise
  automática, o servidor descarta citação que não exista no plano e link que não tenha
  vindo da busca.
- As checagens têm o mesmo número de itens por candidato e vereditos de todo tipo, e
  sempre trazem link para a apuração original.

## Fontes

- Plano de Lula, registrado no TSE em 08/08/2026 (cópia do PDF publicada pelo
  Congresso em Foco).
- Plano de Flávio Bolsonaro, divulgado em 13/08/2026 (cópia do PDF publicada pelo
  Poder360).
- [Página do TSE com os planos de 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/propostas-de-governo-dos-candidatos-ao-cargo-de-presidente-da-republica-eleicoes-2026)
