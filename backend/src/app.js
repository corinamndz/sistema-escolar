const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { ApiError } = require('./utils/ApiError');

const app = express();

app.use(helmet());
// Content-Disposition expuesto: el frontend lee el nombre de los archivos descargados (PDF de horarios).
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Los recibos PDF ya NO se sirven como archivos públicos: tienen datos de la
// familia y del pago. Se descargan con sesión por GET /api/payments/:id/receipt.

// Logos de los colegios (públicos, con nombre UUID no adivinable).
// Helmet pone `Cross-Origin-Resource-Policy: same-origin` por defecto, lo que
// bloquearía el <img> cuando el frontend vive en otro dominio (VITE_API_URL).
app.use(
  '/storage/logos',
  express.static(path.join(__dirname, '..', 'storage', 'logos'), {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d', // los nombres son UUID únicos: un logo nuevo siempre tiene otra URL
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

app.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api', require('./routes'));

// 404
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Ruta no encontrada.' } });
});

// Error handler global: traduce ApiError, errores de Zod y cualquier otro
// error no manejado a una respuesta JSON consistente.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: {
        message: 'Datos inválidos.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: { message: err.message, details: err.details } });
  }

  // Errores de integridad de PostgreSQL que llegaron hasta aquí (el servicio
  // valida antes, pero la base es la última red de seguridad).
  if (err.code === '23514') {
    // Los RAISE de nuestros triggers (sin `constraint`) ya traen un mensaje pensado
    // para el usuario; un CHECK de columna trae texto técnico, así que se generaliza.
    // Knex antepone la consulta al mensaje ("<sql> - <mensaje>"): se conserva solo
    // el mensaje, que por convención nunca contiene " - ".
    const raw = err.message || '';
    const message = err.constraint
      ? 'Los datos no cumplen una regla de validación.'
      : raw.slice(raw.lastIndexOf(' - ') + (raw.includes(' - ') ? 3 : 0));
    return res.status(422).json({ error: { message } });
  }
  // 22P02 = invalid_text_representation: típicamente un id que no es un UUID
  // válido en la URL (enlace mal copiado). Es un error del pedido, no del servidor.
  if (err.code === '22P02') {
    return res.status(400).json({ error: { message: 'Identificador inválido: revisa el enlace o el dato enviado.' } });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: { message: 'Ya existe un registro con esos datos.' } });
  }
  // 23503 = foreign_key_violation; 23001 = restrict_violation (FK con ON DELETE RESTRICT).
  if (err.code === '23503' || err.code === '23001') {
    return res.status(409).json({ error: { message: 'El registro está en uso o hace referencia a un dato inexistente.' } });
  }

  // eslint-disable-next-line no-console
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  // 42703 = columna inexistente, 42P01 = tabla inexistente: el código espera
  // un esquema más nuevo que el de la base (falta correr migraciones).
  if (err.code === '42703' || err.code === '42P01') {
    return res.status(500).json({
      error: { message: 'La base de datos no está actualizada con esta versión del sistema. Pide al administrador que ejecute las migraciones (npm run migrate).' },
    });
  }
  return res.status(500).json({ error: { message: 'Error interno del servidor.' } });
});

module.exports = app;
