/**
 * Spielt den Anmeldeweg mit einer eigenen Azure-Anwendungs-ID einmal
 * durch und sagt, an welcher Stelle er haengt.
 *
 *   node scripts/test-azure-login.mjs [anwendungs-id]
 *
 * Ohne Argument nimmt es die ID, die unten eingetragen ist.
 *
 * Warum es das gibt: Eine neu registrierte Anwendung braucht laut
 * Dokumentation erst eine Freigabe von Mojang, sonst antwortet
 * api.minecraftservices.com mit 403. Diese Freigabe dauert Tage. Statt
 * blind zu warten, laeuft hier derselbe Weg wie im Launcher, nur
 * daneben, und zeigt schwarz auf weiss, ob die Freigabe wirklich fehlt
 * oder ob etwas anderes klemmt.
 *
 * Das Programm fasst den Launcher nicht an: keine Einstellung, kein
 * Account, keine Datei im Datenverzeichnis. Die Tokens bleiben im
 * Arbeitsspeicher, werden nirgends gespeichert und nirgends
 * hingeschickt ausser an Microsoft, Xbox und Minecraft selbst.
 */

const CLIENT_ID = process.argv[2] || 'ddf22ce8-a28e-4da9-bd5f-f723e77140ce'

// Dieselben Adressen und derselbe Scope wie in src/main/auth/microsoft.ts.
const DEVICE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SCOPE = 'XboxLive.signin offline_access'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function step(n, text) {
  console.log(`\n[${n}/5] ${text}`)
}

function ok(text) {
  console.log(`      ✓ ${text}`)
}

/** Cuts a body down to something readable without losing the reason. */
function short(text) {
  const trimmed = String(text ?? '').trim()
  return trimmed.length > 600 ? trimmed.slice(0, 600) + ' …' : trimmed
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  return { res, text: await res.text() }
}

async function main() {
  console.log('Anmeldeweg mit eigener Anwendungs-ID')
  console.log('====================================')
  console.log(`Anwendungs-ID: ${CLIENT_ID}`)

  if (!GUID.test(CLIENT_ID)) {
    console.log('\nX Das ist keine GUID. Der Launcher wuerde diese ID als alte')
    console.log('  Microsoft-Konto-Anwendung behandeln und login.live.com')
    console.log('  ansprechen statt Azure. Abbruch.')
    process.exit(1)
  }

  /* 1. Geraetecode ---------------------------------------------------- */

  step(1, 'Geraetecode bei Microsoft anfordern')

  const deviceRes = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE })
  })
  const deviceText = await deviceRes.text()

  if (!deviceRes.ok) {
    console.log(`      X Microsoft antwortet mit ${deviceRes.status}`)
    console.log(`      ${short(deviceText)}`)
    console.log('\nDeutung: Die Registrierung selbst stimmt noch nicht.')
    console.log('Haeufigste Ursachen:')
    console.log('  - "Oeffentliche Clientflows zulassen" steht auf Deaktiviert')
    console.log('  - Die Kontotypen erlauben keine persoenlichen Konten')
    process.exit(1)
  }

  const device = JSON.parse(deviceText)
  ok('Microsoft nimmt die Anwendung an')

  console.log('\n      ┌─────────────────────────────────────────────')
  console.log(`      │  Seite:  ${device.verification_uri}`)
  console.log(`      │  Code:   ${device.user_code}`)
  console.log('      └─────────────────────────────────────────────')
  console.log('\n      Seite oeffnen, Code eingeben, anmelden.')
  console.log('      Ich warte hier, bis du fertig bist.')

  /* 2. Auf die Anmeldung warten --------------------------------------- */

  step(2, 'Auf deine Anmeldung im Browser warten')

  const deadline = Date.now() + (device.expires_in ?? 900) * 1000
  let interval = (device.interval ?? 5) * 1000
  let accessToken = null

  while (!accessToken) {
    if (Date.now() > deadline) {
      console.log('      X Zeit abgelaufen, niemand hat den Code eingegeben.')
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, interval))

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: CLIENT_ID,
        device_code: device.device_code
      })
    })
    const body = JSON.parse((await res.text()) || '{}')

    if (res.ok) {
      accessToken = body.access_token
      ok('Angemeldet, Microsoft hat ein Token ausgestellt')
      if (body.refresh_token) ok('Ein Erneuerungs-Token kam ebenfalls mit')
      break
    }

    // Diese beiden sind der Normalfall und bedeuten nur "noch nicht".
    if (body.error === 'authorization_pending') continue
    if (body.error === 'slow_down') {
      interval += 5000
      continue
    }

    console.log(`      X Microsoft lehnt ab: ${body.error}`)
    console.log(`      ${short(body.error_description)}`)
    if (body.error === 'invalid_grant') {
      console.log('\nDeutung: Genau der Fehler, den der Launcher mit der alten')
      console.log('Mojang-ID bekommt. Mit einer eigenen ID sollte er weg sein,')
      console.log('taucht er hier trotzdem auf, fehlt an der Registrierung noch')
      console.log('etwas.')
    }
    process.exit(1)
  }

  /* 3. Xbox Live ------------------------------------------------------- */

  step(3, 'Bei Xbox Live anmelden')

  const xbl = await post(XBL_URL, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${accessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })

  if (!xbl.res.ok) {
    console.log(`      X Xbox Live antwortet mit ${xbl.res.status}`)
    console.log(`      ${short(xbl.text)}`)
    process.exit(1)
  }
  const xblBody = JSON.parse(xbl.text)
  ok('Xbox Live hat ein Token ausgestellt')

  /* 4. XSTS ------------------------------------------------------------ */

  step(4, 'XSTS-Token fuer Minecraft holen')

  const xsts = await post(XSTS_URL, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblBody.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  })

  if (!xsts.res.ok) {
    console.log(`      X XSTS antwortet mit ${xsts.res.status}`)
    console.log(`      ${short(xsts.text)}`)
    let xerr
    try {
      xerr = Number(JSON.parse(xsts.text).XErr)
    } catch {
      // Ohne XErr bleibt es bei der rohen Antwort oben.
    }
    if (xerr === 2148916233) console.log('\nDeutung: Das Konto hat kein Xbox-Profil.')
    if (xerr === 2148916238) console.log('\nDeutung: Kinderkonto, braucht eine Familie.')
    process.exit(1)
  }
  const xstsBody = JSON.parse(xsts.text)
  const uhs = xstsBody.DisplayClaims?.xui?.[0]?.uhs
  ok('XSTS hat ein Token fuer Minecraft ausgestellt')

  /* 5. Minecraft ------------------------------------------------------- */

  step(5, 'Bei Minecraft anmelden, der entscheidende Schritt')

  const mc = await post(MC_LOGIN_URL, {
    identityToken: `XBL3.0 x=${uhs};${xstsBody.Token}`
  })

  if (!mc.res.ok) {
    console.log(`      X Minecraft antwortet mit ${mc.res.status}`)
    console.log(`      ${short(mc.text)}`)
    console.log('\n' + '='.repeat(60))
    if (mc.res.status === 403) {
      console.log('ERGEBNIS: Die Freigabe fehlt, genau wie erwartet.')
      console.log('')
      console.log('Alles bis Xbox hat funktioniert, die Azure-Registrierung')
      console.log('ist also richtig eingestellt. Minecraft kennt die')
      console.log('Anwendung nur noch nicht.')
      console.log('')
      console.log('Naechster Schritt: Formular abschicken.')
      console.log('  https://aka.ms/mce-reviewappid')
      console.log(`  Anwendungs-ID: ${CLIENT_ID}`)
    } else {
      console.log(`ERGEBNIS: Unerwarteter Fehler ${mc.res.status}, nicht der 403,`)
      console.log('den eine fehlende Freigabe ausloest. Lohnt sich anzusehen,')
      console.log('bevor irgendein Formular abgeschickt wird.')
    }
    console.log('='.repeat(60))
    process.exit(1)
  }

  const mcBody = JSON.parse(mc.text)
  ok('Minecraft hat die Anwendung akzeptiert')

  const profile = await fetch(MC_PROFILE_URL, {
    headers: { authorization: `Bearer ${mcBody.access_token}` }
  })
  const profileText = await profile.text()

  console.log('\n' + '='.repeat(60))
  if (profile.ok) {
    const me = JSON.parse(profileText)
    console.log('ERGEBNIS: Der ganze Weg laeuft durch, ohne Freigabe.')
    console.log('')
    console.log(`Angemeldet als: ${me.name}`)
    console.log('')
    console.log('Damit ist kein Formular noetig. Die ID kann als Standard')
    console.log('nach src/shared/defaults.ts.')
  } else {
    console.log(`ERGEBNIS: Anmeldung ja, Profil nein (${profile.status}).`)
    console.log(short(profileText))
    console.log('')
    console.log('Meist heisst das nur, dass dieses Konto kein Minecraft')
    console.log('besitzt. Mit der Anwendung selbst hat es nichts zu tun.')
  }
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.log('\nX Abgebrochen: ' + (err?.stack || err?.message || String(err)))
  process.exit(1)
})
