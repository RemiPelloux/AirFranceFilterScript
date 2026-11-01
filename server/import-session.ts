import { closeAirFranceTransport, importFlyingBlueSession } from './airfrance-api.js'

const cookieFile = process.argv[2]
if (!cookieFile) throw new Error('Usage: npm run session:import -- /chemin/vers/cookies.json')

try {
  const imported = await importFlyingBlueSession(cookieFile)
  console.log(`Session Flying Blue importée dans le profil dédié (${imported} cookies Air France).`)
} finally {
  await closeAirFranceTransport()
}
