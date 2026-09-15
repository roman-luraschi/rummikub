# Rummikub AI

Motor de reglas + TableSolver + bot con 5 dificultades, todo en TypeScript.

La **UI piensa en el navegador** (Web Worker), igual que Chess.com / Lichess contra la computadora: no hace falta un servidor para jugar.

## Jugar

```powershell
cd web
npm install
npm run dev
```

Abrí `http://127.0.0.1:5173`. El bot corre en un worker de la pestaña.

## Tests y self-play

```powershell
cd web
npm test
npm run bench -- --a easy --b extreme --games 40 --seed 99
```

Dificultades: `easy`, `normal`, `hard`, `very_hard`, `extreme`.

## Publicar (Cloudflare Pages)

El juego está en: **https://rummikub-ai.pages.dev/**

El repo es privado: https://github.com/roman-luraschi/rummikub-ai  
Un push a `main` corre los tests y actualiza el site.

Para publicar a mano:

```powershell
cd web
npm run deploy
```
