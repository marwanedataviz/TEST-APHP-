// Import Excel côté navigateur — filet de sécurité en complément du script Python (generate_data.py).
// Le format attendu dépend de l'applicatif actuellement sélectionné (window.currentApp).

function aggregateGhuFromHopitaux(hopitaux, useNonConcerneFallback) {
  const ghMap = {};
  hopitaux.forEach(h => {
    if (!ghMap[h.gh]) ghMap[h.gh] = { nom: h.gh, hopitaux: [], deploye: 0, non_deploye: 0, non_concerne: 0, latSum: 0, lonSum: 0 };
    const g = ghMap[h.gh];
    g.hopitaux.push(h.nom);
    g.deploye += h.deploye;
    g.non_deploye += h.non_deploye;
    g.non_concerne += h.non_concerne;
    g.latSum += h.lat;
    g.lonSum += h.lon;
  });
  return Object.keys(ghMap).sort().map(nom => {
    const g = ghMap[nom];
    const n = g.hopitaux.length;
    const denom = (useNonConcerneFallback && g.non_deploye === 0) ? (g.deploye + g.non_concerne) : (g.deploye + g.non_deploye);
    const taux = denom > 0 ? Math.round((100 * g.deploye / denom) * 10) / 10 : 0;
    return {
      nom, lat: g.latSum / n, lon: g.lonSum / n, nb_hopitaux: n,
      deploye: g.deploye, non_deploye: g.non_deploye, non_concerne: g.non_concerne,
      total: g.deploye + g.non_deploye + g.non_concerne, taux
    };
  });
}

// ---- Format "Hospitalisation Complète" : 5 colonnes (GH, Hôpital, Service, UF, Statut) ----
function parseHC(rows, fileName) {
  let dateMaj = new Date().toISOString().slice(0, 10);
  const rawDate = rows[0] && rows[0][4];
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d)) dateMaj = d.toISOString().slice(0, 10);
  }

  const byHopital = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) continue;
    const [gh, hopital, service, uf, statutRaw] = row;
    if (window.EXCLUDE_ENTITIES.includes(hopital)) continue;
    if (!window.HOPITAL_COORDS[hopital]) continue;

    const statut = statutRaw || 'Non renseigné';
    if (!byHopital[hopital]) byHopital[hopital] = { gh: gh || '', services: [], deploye: 0, non_deploye: 0, non_concerne: 0 };
    const h = byHopital[hopital];
    h.gh = h.gh || gh || '';
    h.services.push({ service: service || '', uf: uf || '', statut });
    if (statut === 'Déployé') h.deploye++;
    else if (statut === 'Non Déployé') h.non_deploye++;
    else h.non_concerne++;
  }

  const hopitaux = Object.keys(byHopital).sort().map(nom => {
    const h = byHopital[nom];
    // Pas de 'Non Déployé' dans ce fichier -> taux = Déployé / (Déployé + Non concerné)
    const denom = h.deploye + h.non_deploye;
    const taux = denom > 0 ? Math.round((100 * h.deploye / denom) * 10) / 10 : 0;
    const [lat, lon] = window.HOPITAL_COORDS[nom];
    return {
      nom, gh: h.gh, lat, lon,
      deploye: h.deploye, non_deploye: h.non_deploye, non_concerne: h.non_concerne,
      total: h.deploye + h.non_deploye + h.non_concerne,
      taux, services: h.services
    };
  });

  if (hopitaux.length === 0) throw new Error('Aucun hôpital reconnu — vérifiez que les colonnes sont dans le bon ordre (GH, Hôpital, Service, UF, Statut).');

  return { label: 'Hospitalisation Complète', hasUF: true, date_maj: dateMaj, is_demo_data: false,
    hopitaux, ghu: aggregateGhuFromHopitaux(hopitaux, true) };
}

// ---- Format "Chambre mortuaire" : maille site, colonnes repérées par leur nom d'en-tête ----
function parseCM(rows, fileName) {
  // La ligne d'en-tête est la 2e ligne du fichier (index 1)
  const header = rows[1] || [];
  const idxGh = header.findIndex(c => (c || '').toString().trim() === 'Libelle GH');
  const idxHopital = header.findIndex(c => (c || '').toString().trim() === 'Libelle Hopital');
  const idxStatut = header.findIndex(c => (c || '').toString().trim() === 'Chambre mortuaire Statut');

  if (idxHopital === -1 || idxStatut === -1) {
    throw new Error('Colonnes "Libelle Hopital" ou "Chambre mortuaire Statut" introuvables dans le fichier.');
  }

  const hopitaux = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[idxHopital]) continue;
    const nom = row[idxHopital];
    if (window.EXCLUDE_ENTITIES.includes(nom)) continue;
    if (!window.HOPITAL_COORDS[nom]) continue;

    const statut = row[idxStatut] || 'Non renseigné';
    const [lat, lon] = window.HOPITAL_COORDS[nom];
    hopitaux.push({
      nom, gh: idxGh !== -1 ? (row[idxGh] || '') : '', lat, lon, statut,
      deploye: statut === 'Déployé' ? 1 : 0,
      non_deploye: statut === 'Non Déployé' ? 1 : 0,
      non_concerne: statut === 'Non concerné' ? 1 : 0
    });
  }

  if (hopitaux.length === 0) throw new Error('Aucun hôpital reconnu dans ce fichier "Chambre mortuaire".');

  hopitaux.sort((a, b) => a.nom.localeCompare(b.nom));
  return { label: 'Chambre mortuaire', hasUF: false, date_maj: new Date().toISOString().slice(0, 10),
    is_demo_data: false, hopitaux, ghu: aggregateGhuFromHopitaux(hopitaux, false) };
}

function initImport() {
  const fileInput = document.getElementById('fileInput');
  const importMsg = document.getElementById('importMsg');
  const lastFileInfo = document.getElementById('lastFileInfo');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (!rows || rows.length < 2) throw new Error('Fichier vide ou format inattendu.');

        const app = window.currentApp || 'hc';
        const newData = app === 'hc' ? parseHC(rows, file.name) : parseCM(rows, file.name);

        window.APPLICATIFS[app] = newData;
        if (window.renderAll) window.renderAll();

        importMsg.textContent = `✓ Import réussi (${newData.hopitaux.length} hôpitaux) — ${newData.label}`;
        importMsg.className = 'import-msg success';
        lastFileInfo.textContent = `Dernier fichier : ${file.name} — ${new Date().toLocaleString('fr-FR')}`;
      } catch (err) {
        importMsg.textContent = '✗ Erreur : ' + err.message;
        importMsg.className = 'import-msg error';
      }
    };
    reader.readAsArrayBuffer(file);
    fileInput.value = ''; // permet de réimporter le même fichier deux fois de suite si besoin
  });
}

document.addEventListener('DOMContentLoaded', initImport);
