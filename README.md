# DTU Risk Calculator API

Express API for creating/updating GoHighLevel contacts and triggering the risk calculator email workflow.

## Local setup

1) Install dependencies:
   - `npm install`
2) Create `.env`:
   - Copy `.env.example` to `.env` and set `GHL_API_KEY`.
3) Run the server:
   - `npm start`

## Endpoints

- `GET /health` -> `{ ok: true }`
- `POST /email-plan`
  - JSON body fields: `full_name`, `email`, `profit_target`, `max_loss_limit`, `max_contract_size`,
    `daily_loss_limit`, `trades_until_lost`, `consistency_enabled`, `consistency_rule`, `product`,
    `stop_loss_ticks`, `suggested_contracts`, `risk_per_trade`, `max_sl_hits_per_day`,
    `daily_profit_target`, `max_daily_profit`

## Render Web Service deploy steps

1) Create a new Web Service in Render and connect this repo.
2) Environment:
   - `NODE_VERSION` (e.g. `18`)
   - `GHL_API_KEY` (required)
3) Build command:
   - `npm install`
4) Start command:
   - `npm start`
5) The service listens on `PORT` from Render.
