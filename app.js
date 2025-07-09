const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Crear carpeta de datos si no existe
if (!fs.existsSync("data")) fs.mkdirSync("data");

// Asegurar que los archivos existen
["movements.json", "contadores.json", "umbrales.json"].forEach(file => {
  const filePath = path.join("data", file);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, file === "umbrales.json" ? "{}" : "[]");
});

// Broadcast a todos los clientes
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Conexión WebSocket
wss.on("connection", ws => {
  console.log("Cliente conectado");

  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg);

      if (data.tipo === "detecciones") {
        const movements = JSON.parse(fs.readFileSync("data/movements.json"));
        movements.push(...data.datos);
        fs.writeFileSync("data/movements.json", JSON.stringify(movements, null, 2));
        broadcast({ tipo: "nueva_deteccion", datos: data.datos });
      }

      if (data.tipo === "comando_at") {
        broadcast({ tipo: "comando_at", comando: data.comando });
      }

      if (data.tipo === "get_umbrales") {
        const umbrales = JSON.parse(fs.readFileSync("data/umbrales.json"));
        ws.send(JSON.stringify({ tipo: "umbrales_actuales", datos: umbrales }));
      }

      if (data.tipo === "set_umbrales") {
        fs.writeFileSync("data/umbrales.json", JSON.stringify(data.datos, null, 2));
        broadcast({ tipo: "umbrales_actualizados", datos: data.datos });
      }

    } catch (err) {
      console.error("Error al procesar mensaje:", err.message);
    }
  });

  ws.on("close", () => console.log("Cliente desconectado"));
});

server.listen(PORT, () => {
  console.log(`Servidor WebSocket activo en puerto ${PORT}`);
});
