const ZOOM_THRESHOLD = 12;
const TAUX_GLOBAL_PROVISOIRE = { hc: 78, cm: 45 }; // valeurs fixes en attendant la formule officielle de l'équipe

let map, ghLayer, hopitalLayer;
let selectedHopital = null;
let cameFromGhu = null;
let selectedMarker = null;
let currentApp = 'hc'; // 'hc' = Hospitalisation Complète, 'cm' = Chambre mortuaire
window.currentApp = currentApp;

const GHU_PALETTE = ['#8E8CF0', '#4FBE96', '#3FC1D6', '#F2879C', '#F0C24B', '#7D8CAE'];
let ghuColorMap = {};

function currentData() { return APPLICATIFS[currentApp]; }

// Nouveau code couleur validé par l'équipe :
// Vert = 100% déployé · Orange = en cours · Rouge = à déployer · Gris = non concerné
const COLOR_GREEN = '#2FA37A';
const COLOR_ORANGE = '#F2A33B';
const COLOR_RED = '#E14E42';
const COLOR_GRAY = '#A6B1C4';

function statusColor(taux) {
  if (taux >= 99.95) return COLOR_GREEN;
  if (taux <= 0.05) return COLOR_RED;
  return COLOR_ORANGE;
}

// Couleur à partir d'un objet {deploye, non_deploye, non_concerne, taux} :
// gère aussi le cas "gris" (aucune donnée applicable, tout est Non concerné).
function statusColorFromCounts(o) {
  const denom = (o.deploye || 0) + (o.non_deploye || 0);
  if (denom === 0) return COLOR_GRAY;
  return statusColor(o.taux);
}

// Palette des 5 statuts réels (mosaïque des applicatifs) — option A validée :
// on garde les 4 familles de couleur, avec 2 nuances de rouge pour distinguer
// "Programmé" (plus avancé) de "À programmer" (pas encore planifié).
const STATUT5_COLOR = {
  'Déployé': COLOR_GREEN,
  'Partiellement déployé': COLOR_ORANGE,
  'Programmé': '#C23B30',       // rouge foncé : à déployer, déjà planifié
  'A programmer': '#F0958C',    // rouge clair : à déployer, pas encore planifié
  'Non concerné': COLOR_GRAY
};
function statut5Color(statut) { return STATUT5_COLOR[statut] || COLOR_GRAY; }

// Transformation visuelle pour que les barres restent lisibles même entre 90% et 100%
// (sans quoi deux valeurs comme 92,9% et 98% paraissent quasi identiques à l'oeil)
function barWidth(taux) {
  const d = 100 - taux;
  const w = 100 - Math.sqrt(d) * 10;
  return Math.max(4, Math.min(100, w));
}

function buildGhuColorMap() {
  const names = currentData().ghu.map(g => g.nom).sort();
  ghuColorMap = {};
  names.forEach((n, i) => { ghuColorMap[n] = GHU_PALETTE[i % GHU_PALETTE.length]; });
}

// ---- Sélecteur d'applicatif ----

document.querySelectorAll('.app-switch-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.app === currentApp) return;
    currentApp = btn.dataset.app;
    window.currentApp = currentApp;
    document.getElementById('importMsg').textContent = ''; // efface un message d'erreur/succès resté affiché
    document.querySelectorAll('.app-switch-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('brandSub').textContent = currentData().label + ' · AP-HP';
    document.getElementById('ufSearchSection').style.display = currentData().hasUF ? 'block' : 'none';
    window.renderAll();
  });
});

// Cliquer sur le titre = retour à l'état initial (comme demandé)
document.getElementById('brandTitle').addEventListener('click', () => {
  showEmptyState();
  map.setView([48.8566, 2.3522], 11);
});
document.getElementById('brandTitle').style.cursor = 'pointer';

// ---- Carte ----

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([48.8566, 2.3522], 11);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  ghLayer = L.layerGroup().addTo(map);
  hopitalLayer = L.layerGroup();

  map.on('zoomend', updateLayerVisibility);
  updateLayerVisibility();
}

function updateLayerVisibility() {
  const zoom = map.getZoom();
  const hint = document.getElementById('zoomHint');
  if (zoom >= ZOOM_THRESHOLD) {
    if (map.hasLayer(ghLayer)) map.removeLayer(ghLayer);
    if (!map.hasLayer(hopitalLayer)) map.addLayer(hopitalLayer);
    hint.textContent = 'Vue hôpitaux';
  } else {
    if (map.hasLayer(hopitalLayer)) map.removeLayer(hopitalLayer);
    if (!map.hasLayer(ghLayer)) map.addLayer(ghLayer);
    hint.textContent = 'Vue GHU — zoomez pour voir les hôpitaux';
  }
}

function highlightMarker(marker) {
  if (selectedMarker) selectedMarker.setStyle({ weight: 2 });
  marker.setStyle({ weight: 4 });
  selectedMarker = marker;
}

function popupHtmlGhu(g) {
  return `<div class="map-popup">
    <div class="mp-name">${g.nom}</div>
    <div class="mp-gh">${g.nb_hopitaux} hôpitaux</div>
    <div class="mp-row"><span>Taux</span><span class="mp-taux" style="color:${statusColorFromCounts(g)}">${g.taux}%</span></div>
    <div class="mp-row"><span>Déployé</span><span>${g.deploye}</span></div>
    <div class="mp-row"><span>Non déployé</span><span>${g.non_deploye}</span></div>
  </div>`;
}

function popupHtmlHopital(h) {
  if (currentData().hasUF) {
    return `<div class="map-popup">
      <div class="mp-name">${h.nom}</div>
      <div class="mp-gh">${h.gh}</div>
      <div class="mp-row"><span>Taux</span><span class="mp-taux" style="color:${statusColorFromCounts(h)}">${h.taux}%</span></div>
      <div class="mp-row"><span>Déployé</span><span>${h.deploye}</span></div>
      <div class="mp-row"><span>Non déployé</span><span>${h.non_deploye}</span></div>
    </div>`;
  }
  const c = statusPillColor(h.statut);
  return `<div class="map-popup">
    <div class="mp-name">${h.nom}</div>
    <div class="mp-gh">${h.gh}</div>
    <div class="mp-row"><span>Statut</span><span style="color:${c};font-weight:800">${h.statut}</span></div>
  </div>`;
}

function statusPillColor(statut) {
  if (statut === 'Déployé') return '#2FB8CE';
  if (statut === 'Non Déployé') return '#E8543E';
  return '#A6B1C4';
}

function markerColorForHopital(h) {
  // Couleur du marqueur : toujours par statut de déploiement (aligné avec la mosaïque et les barres)
  return currentData().hasUF ? statusColorFromCounts(h) : statusPillColor(h.statut);
}

function buildMarkers() {
  ghLayer.clearLayers();
  hopitalLayer.clearLayers();

  const data = currentData();

  data.ghu.forEach(g => {
    const radius = 13 + Math.min(11, Math.sqrt(g.total || g.nb_hopitaux) / 2);
    const color = statusColorFromCounts(g);
    const marker = L.circleMarker([g.lat, g.lon], {
      radius, fillColor: color, fillOpacity: 0.85, color: '#fff', weight: 2.5
    });
    marker.bindPopup(popupHtmlGhu(g));
    marker.bindTooltip(g.nom, { direction: 'top', offset: [0, -radius] });
    marker.on('click', () => {
      const bounds = data.hopitaux.filter(h => h.gh === g.nom).map(h => [h.lat, h.lon]);
      if (bounds.length) map.fitBounds(bounds, { padding: [60, 60], maxZoom: ZOOM_THRESHOLD + 1 });
      showGhuListe(g.nom);
      highlightMarker(marker);
    });
    ghLayer.addLayer(marker);
  });

  data.hopitaux.forEach(h => {
    const radius = data.hasUF ? 6 + Math.min(7, Math.sqrt(h.total) / 3) : 7;
    const color = markerColorForHopital(h);
    const marker = L.circleMarker([h.lat, h.lon], {
      radius, fillColor: color, fillOpacity: 0.9, color: '#fff', weight: 2
    });
    marker.bindPopup(popupHtmlHopital(h));
    marker.bindTooltip(h.nom, { direction: 'top', offset: [0, -radius] });
    marker.on('click', () => { showHopitalDetail(h.nom, null); highlightMarker(marker); });
    hopitalLayer.addLayer(marker);
  });
}

// ---- Bandeau global ----

function renderSummaryBar() {
  const data = currentData();

  const sbDeploye = document.getElementById('sbDeploye');
  const sbNonConcerne = document.getElementById('sbNonConcerne');
  const lblAlerte = document.getElementById('lblAlerte');

  if (currentApp === 'cm') {
    // Formule fournie par l'équipe pour Chambre mortuaire :
    // Taux global = nb sites déployés / nb sites total
    const nbTotal = data.hopitaux.length;
    const nbDeploye = data.hopitaux.filter(h => h.statut === 'Déployé').length;
    const nbNonDeploye = data.hopitaux.filter(h => h.statut === 'Non Déployé').length;
    const nbNonConcerne = data.hopitaux.filter(h => h.statut === 'Non concerné').length;
    const taux = nbTotal > 0 ? Math.round((100 * nbDeploye / nbTotal) * 10) / 10 : 0;

    document.getElementById('tauxGlobal').textContent = taux + '%';
    document.getElementById('nbDeploye').textContent = nbDeploye;
    document.getElementById('nbAlerte').textContent = nbNonDeploye;
    document.getElementById('nbNonConcerne').textContent = nbNonConcerne;
    lblAlerte.textContent = 'Sites non déployés';
    sbDeploye.style.display = 'flex';
    sbNonConcerne.style.display = 'flex';
  } else {
    // Hospitalisation Complète : toujours une valeur provisoire, en attente de la formule officielle
    document.getElementById('tauxGlobal').textContent = TAUX_GLOBAL_PROVISOIRE[currentApp] + '%';
    const nbNonDeploye = data.hopitaux.filter(h => h.non_deploye > 0).length;
    document.getElementById('nbAlerte').textContent = nbNonDeploye;
    lblAlerte.textContent = 'Sites non déployés';
    sbDeploye.style.display = 'none';
    sbNonConcerne.style.display = 'none';
  }

  const strip = document.getElementById('ghuStrip');
  strip.innerHTML = '';
  data.ghu.forEach(g => {
    const ghColor = ghuColorMap[g.nom] || '#3FC1D6';
    const pill = document.createElement('div');
    pill.className = 'ghu-pill';
    pill.style.borderColor = ghColor + '55';
    pill.innerHTML = `<span class="dot" style="background:${ghColor}"></span>
      <span>${g.nom.replace('AP-HP.', '')}</span>
      <span class="taux" style="color:${statusColorFromCounts(g)}">${g.taux}%</span>`;
    pill.addEventListener('click', () => {
      const bounds = data.hopitaux.filter(h => h.gh === g.nom).map(h => [h.lat, h.lon]);
      if (bounds.length) map.fitBounds(bounds, { padding: [60, 60], maxZoom: ZOOM_THRESHOLD + 1 });
      showGhuListe(g.nom);
    });
    strip.appendChild(pill);
  });
}

// ---- États de la fiche ----

function resetStates() {
  document.getElementById('stateEmpty').style.display = 'none';
  document.getElementById('stateListe').style.display = 'none';
  document.getElementById('stateDetail').style.display = 'none';
}

function showEmptyState() {
  resetStates();
  document.getElementById('stateEmpty').style.display = 'flex';
  selectedHopital = null;
  cameFromGhu = null;
  if (selectedMarker) { selectedMarker.setStyle({ weight: 2 }); selectedMarker = null; }
}

function showGhuListe(ghNom) {
  resetStates();
  document.getElementById('stateListe').style.display = 'block';

  const data = currentData();
  const g = data.ghu.find(x => x.nom === ghNom);
  const hopitaux = data.hopitaux.filter(h => h.gh === ghNom)
    .sort((a, b) => (data.hasUF ? a.taux - b.taux : 0));

  document.getElementById('ghuName').textContent = ghNom;
  document.getElementById('ghuMeta').textContent = `${hopitaux.length} hôpitaux`;
  const tauxEl = document.getElementById('ghuTaux');
  tauxEl.textContent = g.taux + '%';
  tauxEl.style.color = statusColorFromCounts(g);

  const list = document.getElementById('hopitalList');
  list.innerHTML = '';
  hopitaux.forEach(h => {
    const row = document.createElement('div');
    row.className = 'hopital-row';
    if (data.hasUF) {
      const c = statusColorFromCounts(h);
      row.innerHTML = `<span class="name">${h.nom}</span>
        <span class="mini-bar-track"><span class="mini-bar-fill" style="width:${h.taux}%;background:${c}"></span></span>
        <span class="taux-tag" style="background:${c}22;color:${c}">${h.taux}%</span>`;
    } else {
      const c = statusPillColor(h.statut);
      row.innerHTML = `<span class="name">${h.nom}</span>
        <span class="taux-tag" style="background:${c}22;color:${c}">${h.statut}</span>`;
    }
    row.addEventListener('click', () => showHopitalDetail(h.nom, ghNom));
    list.appendChild(row);
  });
}

function showHopitalDetail(nom, fromGhu) {
  resetStates();
  cameFromGhu = fromGhu;
  const backLink = document.getElementById('backLink');
  backLink.style.display = fromGhu ? 'inline-flex' : 'none';

  const data = currentData();
  const h = data.hopitaux.find(x => x.nom === nom);
  if (!h) return;
  selectedHopital = h;

  if (data.hasUF) {
    document.getElementById('stateDetailUf').style.display = 'block';
    document.getElementById('stateDetailSite').style.display = 'none';

    document.getElementById('hName').textContent = h.nom;
    document.getElementById('hGh').textContent = h.gh;
    document.getElementById('kpiTaux').textContent = h.taux + '%';
    document.getElementById('kpiTaux').style.color = statusColorFromCounts(h);
    document.getElementById('kpiDeploye').textContent = h.deploye;
    document.getElementById('kpiNonConcerne').textContent = h.non_concerne;

    const totalCalc = h.deploye + h.non_deploye;
    document.getElementById('hProgressFill').style.width = (totalCalc > 0 ? (100 * h.deploye / totalCalc) : 0) + '%';
    document.getElementById('hProgressFrac').textContent = `${h.deploye}/${totalCalc} déployés`;

    document.getElementById('tableSearch').value = '';
    document.getElementById('statutFilter').value = '';
    renderTable(h.services);
  } else {
    document.getElementById('stateDetailUf').style.display = 'none';
    document.getElementById('stateDetailSite').style.display = 'block';

    document.getElementById('hNameSite').textContent = h.nom;
    document.getElementById('hGhSite').textContent = h.gh;
    const c = statusPillColor(h.statut);
    const cls = h.statut === 'Déployé' ? 'deploye' : h.statut === 'Non Déployé' ? 'non-deploye' : 'non-concerne';
    document.getElementById('siteStatusBadge').innerHTML =
      `<span class="ssc-shape status-shape ${cls}"></span> ${h.statut}`;
    document.getElementById('siteStatusBadge').style.background = c + '18';
    document.getElementById('siteStatusBadge').style.color = c;
    document.getElementById('kpiNbFormations').textContent = h.nb_formations ?? '–';
    document.getElementById('kpiNbPersonnes').textContent = h.nb_personnes_formees ?? '–';
    const dateEl = document.getElementById('siteDateMaj');
    if (h.date_maj_site) {
      dateEl.textContent = `Dernière mise à jour du statut : ${new Date(h.date_maj_site).toLocaleDateString('fr-FR')}`;
      dateEl.style.display = 'block';
    } else {
      dateEl.style.display = 'none';
    }
  }

  document.getElementById('stateDetail').style.display = 'block';
  map.flyTo([h.lat, h.lon], 14, { duration: 0.6 });
}

document.getElementById('backLink').addEventListener('click', () => {
  if (cameFromGhu) showGhuListe(cameFromGhu);
});

// tri table UF : Non déployé en premier, puis Non concerné, puis Déployé
const STATUT_ORDER = { 'Non Déployé': 0, 'Non concerné': 1, 'Déployé': 2 };

function renderTable(services) {
  const tbody = document.getElementById('ufTableBody');
  tbody.innerHTML = '';
  const search = document.getElementById('tableSearch').value.toLowerCase();
  const statutFilter = document.getElementById('statutFilter').value;

  let filtered = services.filter(s => {
    const matchesSearch = !search || s.service.toLowerCase().includes(search) || s.uf.toLowerCase().includes(search);
    const matchesStatut = !statutFilter || s.statut === statutFilter;
    return matchesSearch && matchesStatut;
  });

  filtered = filtered.slice().sort((a, b) => (STATUT_ORDER[a.statut] ?? 3) - (STATUT_ORDER[b.statut] ?? 3));

  document.getElementById('rowCount').textContent = `${filtered.length} ligne(s) sur ${services.length}`;

  const rowClass = { 'Déployé': 'row-deploye', 'Non Déployé': 'row-non-deploye', 'Non concerné': 'row-non-concerne' };
  const shapeClass = { 'Déployé': 'deploye', 'Non Déployé': 'non-deploye', 'Non concerné': 'non-concerne' };

  filtered.forEach(s => {
    const cls = shapeClass[s.statut] || 'non-concerne';
    const tr = document.createElement('tr');
    tr.className = rowClass[s.statut] || '';
    tr.innerHTML = `
      <td>${s.service || '<em>—</em>'}</td>
      <td>${s.uf || '<em>—</em>'}</td>
      <td><span class="status-tag ${cls}"><span class="status-shape ${cls}"></span>${s.statut}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('tableSearch').addEventListener('input', () => { if (selectedHopital) renderTable(selectedHopital.services); });
document.getElementById('statutFilter').addEventListener('change', () => { if (selectedHopital) renderTable(selectedHopital.services); });

// ---- Recherche hôpital (carte) ----

const searchInput = document.getElementById('searchInput');
const suggestionsBox = document.getElementById('searchSuggestions');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  suggestionsBox.innerHTML = '';
  if (!q) { suggestionsBox.classList.remove('active'); return; }

  const matches = currentData().hopitaux.filter(h => h.nom.toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) { suggestionsBox.classList.remove('active'); return; }

  matches.forEach(h => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    const label = currentData().hasUF ? h.taux + '%' : h.statut;
    item.innerHTML = `<span>${h.nom}</span><span class="gh-tag">${label}</span>`;
    item.addEventListener('click', () => {
      searchInput.value = h.nom;
      suggestionsBox.classList.remove('active');
      showHopitalDetail(h.nom, null);
    });
    suggestionsBox.appendChild(item);
  });
  suggestionsBox.classList.add('active');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) suggestionsBox.classList.remove('active');
});

// ---- Bloc 4 : recherche globale par UF (seulement si applicatif a des UF) ----

const ufSearchInput = document.getElementById('ufSearchInput');
const ufSearchResults = document.getElementById('ufSearchResults');

function renderUfSearch() {
  if (!currentData().hasUF) { ufSearchResults.innerHTML = ''; return; }

  const q = ufSearchInput.value.trim().toLowerCase();
  ufSearchResults.innerHTML = '';

  if (!q) {
    ufSearchResults.innerHTML = '<div class="uf-empty">Tapez le nom d\'une UF pour voir dans quels hôpitaux elle est déployée.</div>';
    return;
  }

  const data = currentData();
  const matchesByUf = {};

  data.hopitaux.forEach(h => {
    h.services.forEach(s => {
      if (s.uf && s.uf.toLowerCase().includes(q)) {
        if (!matchesByUf[s.uf]) matchesByUf[s.uf] = [];
        matchesByUf[s.uf].push({ hopital: h.nom, gh: h.gh, statut: s.statut });
      }
    });
  });

  const ufNames = Object.keys(matchesByUf).sort();
  if (ufNames.length === 0) {
    ufSearchResults.innerHTML = '<div class="uf-empty">Aucune UF trouvée pour cette recherche.</div>';
    return;
  }

  const statusLabel = { 'Déployé': 'deploye', 'Non Déployé': 'non-deploye', 'Non concerné': 'non-concerne' };

  ufNames.slice(0, 25).forEach(ufNom => {
    const entries = matchesByUf[ufNom];
    const applicable = entries.filter(e => e.statut !== 'Non concerné');
    const deployedCount = entries.filter(e => e.statut === 'Déployé').length;
    const pct = applicable.length > 0 ? Math.round(100 * deployedCount / applicable.length) : 0;

    const group = document.createElement('div');
    group.className = 'uf-result-group';
    group.innerHTML = `<div class="uf-result-group-title">${ufNom}</div>
      <div class="uf-result-group-meta">Présente dans ${entries.length} hôpital(aux) · déployée dans ${pct}% des cas applicables</div>
      <div class="uf-result-cards"></div>`;

    const cardsWrap = group.querySelector('.uf-result-cards');
    entries.forEach(e => {
      const cls = statusLabel[e.statut] || 'non-concerne';
      const card = document.createElement('div');
      card.className = 'uf-mini-card';
      card.innerHTML = `
        <div class="umc-hopital">${e.hopital}</div>
        <div class="umc-gh">${e.gh}</div>
        <span class="umc-status status-tag ${cls}"><span class="status-shape ${cls}"></span>${e.statut}</span>
      `;
      cardsWrap.appendChild(card);
    });

    ufSearchResults.appendChild(group);
  });

  if (ufNames.length > 25) {
    const more = document.createElement('div');
    more.className = 'uf-empty';
    more.textContent = `+ ${ufNames.length - 25} autre(s) UF correspondante(s) — affinez la recherche pour les voir.`;
    ufSearchResults.appendChild(more);
  }
}

ufSearchInput.addEventListener('input', renderUfSearch);

// ---- Bloc 5 : mosaïque (treemap) des hôpitaux ----

function renderMosaic() {
  const section = document.getElementById('mosaicSection');
  const data = currentData();

  if (!data.hasUF) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const container = document.getElementById('mosaicContainer');
  container.innerHTML = '';

  const items = data.hopitaux.filter(h => h.total > 0).slice().sort((a, b) => a.taux - b.taux);

  items.forEach(hop => {
    const block = document.createElement('div');
    block.className = 'mosaic-block';
    block.style.background = statusColorFromCounts(hop);
    block.title = `${hop.nom} — ${hop.taux}% (${hop.total} UF)`;
    block.innerHTML = `<div class="mb-name">${hop.nom}</div><div class="mb-taux">${hop.taux}%</div>`;
    block.addEventListener('click', () => { showHopitalDetail(hop.nom, null); });
    container.appendChild(block);
  });
}

// ---- Bloc 6 : mosaïque des applicatifs par GH ----

const CATEGORIE_COLOR = { bleu: '#3D74B0', jaune: '#F0C24B', violet: '#7C4DBE', vert: '#4C9A6B' };
const CATEGORIE_ORDER = ['bleu', 'jaune', 'violet', 'vert'];

function renderAppMosaic() {
  const section = document.getElementById('appMosaicSection');
  const mosaic = window.MOSAIC_APPLICATIFS_DATA;
  if (!mosaic) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const container = document.getElementById('appMosaicContainer');
  container.innerHTML = '';

  const byCategorie = {};
  CATEGORIE_ORDER.forEach(c => byCategorie[c] = []);
  mosaic.applicatifs.forEach(a => byCategorie[a.categorie].push(a));

  const ghNames = Object.keys(mosaic.par_ghu).sort();

  ghNames.forEach(gh => {
    const card = document.createElement('div');
    card.className = 'gh-app-card';

    const cols = CATEGORIE_ORDER.map(cat => {
      const apps = byCategorie[cat];
      const chips = apps.map(a => {
        const statut = mosaic.par_ghu[gh][a.id];
        const color = statut5Color(statut);
        return `<div class="gh-app-chip" style="background:${color}" title="${a.label} — ${statut}${a.fictif ? ' (fictif)' : ''}">${a.label}</div>`;
      }).join('');
      return `<div>
        ${chips}
      </div>`;
    }).join('');

    card.innerHTML = `<div class="gh-app-title">${gh}</div><div class="gh-app-columns">${cols}</div>`;
    container.appendChild(card);
  });
}

// ---- Rendu global ----

window.renderAll = function () {
  buildGhuColorMap();
  buildMarkers();
  renderSummaryBar();
  showEmptyState();
  renderUfSearch();
  renderMosaic();
  renderAppMosaic();
};

initMap();
window.renderAll();
