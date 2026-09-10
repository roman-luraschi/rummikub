# Rummikub AI

Motor de reglas + TableSolver + bot con 5 dificultades.

La **UI piensa en el navegador** (TypeScript + Web Worker), igual que Chess.com / Lichess contra la computadora: no hace falta Python para jugar. El motor Python queda como **legacy** para tests, bench y la API FastAPI.

## Jugar (solo UI)

```powershell
cd web
npm install
npm run dev
```

Abrí `http://127.0.0.1:5173`. El bot corre en un worker de la pestaña; no levantes uvicorn.

## Python legacy

Tests, self-play y el servidor HTTP (por si querés el cliente `web/src/api.ts`):

```powershell
cd C:\Users\DGOGPP\rummikub-ai
python -m pip install -e .[dev]
$env:PYTHONPATH='engine'
python -m pytest
python -m rummikub.bench --a easy --b extreme --games 40 --seed 1
python -m uvicorn rummikub.api.server:app --host 127.0.0.1 --port 8000
```

Self-play del motor TypeScript (el que usa la UI):

```powershell
cd web
npm run bench -- --a easy --b extreme --games 40 --seed 99
```

Dificultades: `easy`, `normal`, `hard`, `very_hard`, `extreme`.

## Publicar (Cloudflare Pages)

El juego está en: **https://rummikub-ai.pages.dev/**

El repo es privado: https://github.com/roman-luraschi/rummikub-ai  
Un push a `main` dispara GitHub Actions y actualiza el site. No hace falta Python.

Para publicar a mano:

```powershell
cd web
npm run deploy
```
