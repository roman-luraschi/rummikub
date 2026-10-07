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

## Multijugador

La partida local sigue en el navegador. Las salas online las lleva un Worker con un Durable Object por código, en `server/`.

En una terminal, con Node 22 o más (`nvm use 24` si el `node` por defecto es más viejo):

```powershell
cd server
npm install
npm run dev
```

En otra, `cd web` y `npm run dev`. El sitio en `http://127.0.0.1:5173` habla con el Worker por el proxy de Vite. En el menú, "En línea" crea o busca una sala.

## Publicar (Cloudflare Pages)

El juego está en: **https://rummikub-ai.pages.dev/**

El repo es privado: https://github.com/roman-luraschi/rummikub-ai  
Un push a `main` corre los tests, publica esta página y despliega el Worker de salas.

El build de Pages usa el secret `VITE_MULTIPLAYER_URL` (la URL `https://rummikub-rooms.<subdominio>.workers.dev` que imprime `npm run deploy` en `server/`). El token de Cloudflare tiene que poder publicar Workers y Durable Objects, además de Pages.

Para publicar a mano:

```powershell
cd web
npm run deploy
```
