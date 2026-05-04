# SFMC Monitor — Chrome Extension

> Monitor vos **Journeys** et **Automations** SFMC en temps réel — sans API key, juste avec votre session active.

---

## ⚡ Démarrage rapide

```bash
# 1. Cloner / décompresser le projet
cd sfmc-monitor

# 2. Setup (vérifie l'environnement + build)
npm run setup

# 3. Lancer Chrome avec l'extension pré-chargée
npm run dev
```

C'est tout. Chrome s'ouvre sur mc.exacttarget.com avec l'extension déjà installée.

---

## 📋 Commandes disponibles

| Commande | Description |
|----------|-------------|
| `npm run setup` | Vérifie Node, copie les fichiers, détecte Chrome |
| `npm run build` | Compile `src/` → `dist/` |
| `npm run open`  | Lance Chrome avec l'extension chargée |
| `npm run dev`   | Build + lancement en une commande |
| `npm run pack`  | Génère un `.zip` distribuable |

---

## 🔄 Workflow complet

```
sfmc-monitor/
├── src/              ← Code source (éditer ici)
│   ├── manifest.json
│   ├── background.js   # Service worker — capture token + proxy API
│   ├── content.js      # Script page — extrait session SFMC
│   ├── popup.html      # UI du dashboard
│   ├── popup.js        # Calcul KPIs + rendu
│   └── icons/
├── dist/             ← Build (généré par npm run build)
├── scripts/          ← Scripts Node.js
│   ├── setup.js
│   ├── build.js
│   ├── open-chrome.js
│   └── pack.js
└── package.json
```

Modifiez les fichiers dans `src/`, puis relancez `npm run dev`.

---

## 🔑 Comment ça fonctionne (sans API key)

L'extension utilise **3 mécanismes** pour capturer votre session :

```
Vous naviguez dans SFMC
        │
        ▼
[background.js] intercepte les requêtes HTTP de l'UI SFMC
  → capture le header Authorization: Bearer <token>
        │
        ▼
[content.js] cherche aussi dans localStorage / sessionStorage
        │
        ▼
[popup.js] utilise ce token pour appeler les mêmes endpoints
  /interaction/v1/interactions  → Journey Builder KPIs
  /automation/v1/automations    → Automation Studio KPIs
```

---

## 📊 KPIs disponibles

### Journey Builder
- Total / Actifs / Draft / En erreur
- Contacts actuellement dans les journeys
- Contacts ayant atteint l'objectif (Goal Met)

### Automation Studio
- Total / Actifs / Running / Scheduled / Paused / Erreurs
- Dernière exécution

---

## ⚙️ Prérequis

- **Node.js** ≥ 16 (`node --version`)
- **Google Chrome** (ou Chromium)

---

## 🛠️ Installation manuelle (sans terminal)

Si vous préférez sans terminal :

1. Téléchargez le projet et allez dans le dossier `dist/` (ou lancez `npm run build` pour le générer)
2. Ouvrez Chrome → `chrome://extensions/`
3. Activez le **Mode développeur** (toggle en haut à droite)
4. Cliquez **"Charger l'extension non empaquetée"** → sélectionnez `dist/`

---

## 📦 Distribuer l'extension

```bash
npm run pack
# → sfmc-monitor-v1.0.0.zip
```

Ce fichier peut être partagé. Le destinataire le décompresse et charge `dist/` dans Chrome.
