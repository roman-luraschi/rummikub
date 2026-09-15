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
npm run bench -- hard easy 8 1
npm run bench -- extreme hard 12 1
```

En Windows, `npm run bench -- --a extreme` se come los flags; pasá `dificultadA dificultadB juegos seed` como argumentos posicionales. Hard debería ganar la mayoría vs Easy. Extreme vs Hard es más lento (~15s por partida) y sirve para ver si Extreme se separa; si no, hay que subir el peso del ply, no el reloj.

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
