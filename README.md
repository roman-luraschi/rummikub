Rummi Online
Rummikub en el navegador, con un bot de 5 niveles de dificultad y multijugador online por salas.

Jugar ahora en rummi-online.com

<!-- Agregá acá una captura o GIF del juego: ![Rummi Online](docs/screenshot.png) -->
Qué tiene
Motor de reglas y solver de mesa: valida jugadas y busca reacomodos válidos de las fichas que ya están en la mesa.
Bot con 5 dificultades (easy, normal, hard, very_hard, extreme) que corre en un Web Worker, en tu navegador y sin servidor, igual que jugar contra la computadora en Chess.com o Lichess.
Multijugador online: salas por código, con un Cloudflare Worker y un Durable Object por sala.
Tests y benchmarks de self-play: el bot juega contra sí mismo para medir si cada dificultad realmente le gana a la anterior.
Stack
Frontend: React 18, TypeScript, Vite y Tailwind CSS 4.
Bot: TypeScript corriendo en un Web Worker.
Multijugador: Cloudflare Workers y Durable Objects.
Deploy: Cloudflare, con CI que en cada push a main corre los tests y publica.
Correrlo localmente
Requiere Node 22 o superior.


cd web
npm install
npm run dev
Abrí http://127.0.0.1:5173.

Para jugar online en local, levantá además el servidor de salas en otra terminal:


cd server
npm install
npm run dev
El sitio se comunica con el Worker a través del proxy de Vite. En el menú, "En línea" crea o busca una sala.

Tests y self-play

cd web
npm test
npm run bench -- hard easy 8 1
Los argumentos de bench son dificultadA dificultadB partidas seed. Se espera que Hard le gane a Easy la mayoría de las partidas.

Deploy
Un push a main corre los tests, publica el sitio y despliega el Worker de salas. El build necesita la variable VITE_MULTIPLAYER_URL con la URL del Worker que imprime npm run deploy en server/.

Autor
Román Rodríguez Luraschi · LinkedIn · GitHub