const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { ApiError } = require('./utils/ApiError');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Comprobantes de pago en PDF, servidos como archivos estáticos.
app.use('/storage/receipts', express.static(path.join(__dirname, '..', 'storage', 'receipts')));

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

  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: { message: 'Error interno del servidor.' } });
});

module.exports = app;
