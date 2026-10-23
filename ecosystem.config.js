// pm2 håller igång programmen och startar om dem om de kraschar.
module.exports = {
  apps: [
    { name: 'slapandtalk', script: 'server/index.js', max_memory_restart: '300M' },
    {
      // Cloudflare "quick tunnel": ger en gratis publik https-adress, inget konto behövs.
      // Adressen byts varje gång tunneln startas om.
      name: 'slapandtalk-tunnel', script: 'cloudflared', interpreter: 'none',
      args: 'tunnel --no-autoupdate --protocol http2 --url http://localhost:8787',
    },
  ],
};
