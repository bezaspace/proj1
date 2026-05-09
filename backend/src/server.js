import express from 'express'
import cors from 'cors'
import morgan from 'morgan'

const app = express()
const port = Number(process.env.PORT || 4000)

app.use(cors())
app.use(express.json())
app.use(morgan('dev'))

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'backend' })
})

app.get('/', (_req, res) => {
  res.json({ message: 'SynapseDrive backend is ready', health: '/health' })
})

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`)
})
