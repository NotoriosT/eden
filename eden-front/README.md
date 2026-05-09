# Frontend React (Painel)

## O que tem
- Dashboard com KPIs e gráfico de histórico
- Alertas de parâmetro fora da faixa
- Timeline de execução real
- Gestão de plantas e fases
- Regras e acionamento manual

## Rodar com Docker (recomendado)
Use o `docker-compose.yml` da raiz.

## Rodar local
```bash
cd frontend-react
npm install
npm run dev
```

## URL
- `http://localhost:5173`

## Config
Variável opcional:
- `VITE_API_URL` (ex.: `http://localhost:8080`)

## Como usar
1. Abra aba `Regras + Ações`
2. Defina faixas de temperatura, umidade, solo e luz
3. Defina horário de luz (`início` e `fim`)
4. Salve regras
5. Vá para `Operação` e acompanhe alertas e execução
