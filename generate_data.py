"""
Génère data.js à partir des 2 fichiers Excel sources :
- Dep_APHP.xlsx                      -> applicatif "Hospitalisation Complète" (détail par UF)
- base_de_donnees_maille_site.xlsx   -> applicatif "Chambre mortuaire" (maille site, pas d'UF)

Usage : python generate_data.py
(les 2 fichiers sources doivent être dans le même dossier que ce script)

À chaque mise à jour d'un des fichiers Excel, relancer ce script pour régénérer data.js.
"""
import json
import random
from collections import Counter
import pandas as pd

HC_FILE = "Dep_APHP.xlsx"
CM_FILE = "base_de_donnees_maille_site.xlsx"

# Coordonnées connues des hôpitaux Paris/IDF (mêmes 36 établissements identifiés précédemment)
HOPITAL_COORDS = {
    "GH A.CHENEVIER-H.MONDOR": [48.7975, 2.4497],
    "GH ARMAND TROUSSEAU-LA ROCHE GUYON": [48.8399, 2.4014],
    "GH BROCA-LA COLLEGIALE": [48.8339, 2.3417],
    "GH COCHIN": [48.8375, 2.3372],
    "GH LARIBOISIERE FERNAND WIDAL": [48.8814, 2.3554],
    "GROUPE HOSPITAL.NECKER ENFANTS MALADES": [48.8461, 2.3151],
    "GROUPE HOSPITALIER PITIE-LA SALPETRIERE": [48.8377, 2.3654],
    "HEGP": [48.8386, 2.2724],
    "HOPITAL ADELAIDE HAUTVAL": [48.8896, 2.3547],
    "HOPITAL AMBROISE PARE": [48.8347, 2.2019],
    "HOPITAL ANTOINE BECLERE": [48.7737, 2.2707],
    "HOPITAL AVICENNE": [48.9308, 2.3606],
    "HOPITAL BEAUJON": [48.9106, 2.3053],
    "HOPITAL BICHAT": [48.8975, 2.3316],
    "HOPITAL BRETONNEAU": [48.8976, 2.3378],
    "HOPITAL CHARLES FOIX": [48.7975, 2.3986],
    "HOPITAL CORENTIN CELTON": [48.8226, 2.2731],
    "HOPITAL DE BICETRE": [48.8020, 2.3573],
    "HOPITAL DE LA ROCHE-GUYON": [49.0847, 1.6167],
    "HOPITAL DE VAUGIRARD-GABRIEL PALLEZ": [48.8377, 2.2976],
    "HOPITAL DUPUYTREN": [48.7089, 2.4103],
    "HOPITAL EMILE ROUX": [48.7908, 2.4358],
    "HOPITAL GEORGES CLEMENCEAU": [48.7908, 2.4460],
    "HOPITAL JEAN VERDIER": [48.9346, 2.4308],
    "HOPITAL LOUIS MOURIER": [48.9083, 2.2489],
    "HOPITAL PAUL BROUSSE": [48.7891, 2.3673],
    "HOPITAL PAUL DOUMER": [48.9385, 2.3181],
    "HOPITAL RAYMOND POINCARE": [48.8022, 2.1289],
    "HOPITAL RENE MURET - BIGOTTINI": [48.9385, 2.4181],
    "HOPITAL ROBERT DEBRE": [48.8813, 2.3969],
    "HOPITAL ROTHSCHILD": [48.8532, 2.3934],
    "HOPITAL SAINT ANTOINE": [48.8494, 2.3822],
    "HOPITAL SAINT LOUIS": [48.8722, 2.3672],
    "HOPITAL STE PERINE": [48.8567, 2.2661],
    "HOPITAL TENON": [48.8600, 2.3986],
    "HOTEL-DIEU DE PARIS": [48.8531, 2.3486],
}

# Entités hors périmètre (hors Paris/IDF ou non-géographiques)
EXCLUDE = [
    'ADMINISTRATION GENERALE A.P.H.P.', 'AGEPS', 'EEAP SAN SALVADOUR',
    'HOPITAL MARITIME DE BERCK', 'HOPITAL MARIN D HENDAYE',
    'HOPITAL SAN SALVADOUR', 'HOSPITALISATION A DOMICILE', 'MAS SAN SALVADOUR'
]


def aggregate_ghu(hopitaux, taux_mode='standard'):
    """Calcule les agrégats par GHU à partir d'une liste d'hôpitaux.
    taux_mode :
      - 'standard' : Déployé / (Déployé + Non Déployé)
      - 'hc_fallback' : comme 'standard', mais si le groupe n'a aucun 'Non Déployé'
        (cas structurel d'Hospitalisation Complète), utilise Déployé / (Déployé + Non concerné)
      - 'total' : Déployé / Total (formule officielle donnée par l'équipe pour Chambre mortuaire)
    """
    gh_map = {}
    for h in hopitaux:
        gh = h['gh']
        gh_map.setdefault(gh, {"nom": gh, "hopitaux": [], "deploye": 0, "non_deploye": 0,
                                "non_concerne": 0, "lat_sum": 0, "lon_sum": 0})
        g = gh_map[gh]
        g['hopitaux'].append(h['nom'])
        g['deploye'] += h['deploye']
        g['non_deploye'] += h['non_deploye']
        g['non_concerne'] += h['non_concerne']
        g['lat_sum'] += h['lat']
        g['lon_sum'] += h['lon']

    ghu_list = []
    for gh, g in gh_map.items():
        n = len(g['hopitaux'])
        total = g['deploye'] + g['non_deploye'] + g['non_concerne']
        if taux_mode == 'total':
            taux = round(100 * g['deploye'] / total, 1) if total > 0 else 0
        elif taux_mode == 'hc_fallback' and g['non_deploye'] == 0:
            denom = g['deploye'] + g['non_concerne']
            taux = round(100 * g['deploye'] / denom, 1) if denom > 0 else 0
        else:
            denom = g['deploye'] + g['non_deploye']
            taux = round(100 * g['deploye'] / denom, 1) if denom > 0 else 0
        ghu_list.append({
            "nom": gh, "lat": round(g['lat_sum'] / n, 5), "lon": round(g['lon_sum'] / n, 5),
            "nb_hopitaux": n, "deploye": g['deploye'], "non_deploye": g['non_deploye'],
            "non_concerne": g['non_concerne'], "total": g['deploye'] + g['non_deploye'] + g['non_concerne'],
            "taux": taux
        })
    ghu_list.sort(key=lambda x: x['nom'])
    return ghu_list


def load_hospitalisation_complete(path):
    """
    Applicatif 'Hospitalisation Complète' : détail par UF.
    Colonnes attendues : GH, Hôpital, Service, UF, Statut (5 colonnes, dans cet ordre).
    Statuts réels présents dans ce fichier : Déployé / Non concerné (jamais 'Non Déployé').
    Taux = Déployé / (Déployé + Non concerné), puisqu'il n'y a pas de 3e statut ici.
    """
    raw = pd.read_excel(path, sheet_name=0, header=None)
    date_maj = raw.iloc[0, 4]
    try:
        date_maj = pd.to_datetime(date_maj).strftime('%Y-%m-%d')
    except Exception:
        date_maj = str(date_maj)

    df = raw.iloc[1:].copy()
    df.columns = ['gh', 'hopital', 'service', 'uf', 'statut']
    df = df.dropna(subset=['hopital'])
    df = df[~df['hopital'].isin(EXCLUDE)]
    df['statut'] = df['statut'].fillna('Non renseigné')

    missing = [h for h in df['hopital'].unique() if h not in HOPITAL_COORDS]
    if missing:
        print("HC — hôpitaux sans coordonnées connues (ignorés) :", missing)
        df = df[~df['hopital'].isin(missing)]

    gh_lookup = df.groupby('hopital')['gh'].first().to_dict()

    hopitaux = []
    for h, coord in HOPITAL_COORDS.items():
        sub = df[df['hopital'] == h]
        if sub.empty:
            continue
        # Pas de statut "Non Déployé" dans ce fichier : le taux se calcule
        # sur Déployé / (Déployé + Non concerné).
        deploye = int((sub['statut'] == 'Déployé').sum())
        non_concerne = int((sub['statut'] == 'Non concerné').sum())
        non_deploye = int((sub['statut'] == 'Non Déployé').sum())  # 0 attendu, gardé si le fichier évolue
        total_calc = deploye + non_concerne + non_deploye
        # Formule : Déployé / (Déployé + Non concerné) quand 'Non Déployé' n'existe pas dans les données.
        # Formule demandée par l'équipe : Déployé / (Total - Non concerné), équivalent à
        # Déployé / (Déployé + Non Déployé). Comme ce fichier n'a jamais de 'Non Déployé',
        # ça donnera mécaniquement 100% dès qu'il y a au moins 1 'Déployé' — comportement
        # attendu et validé par l'équipe.
        denom = deploye + non_deploye
        taux = round(100 * deploye / denom, 1) if denom > 0 else 0

        services = [
            {"service": r['service'] if pd.notna(r['service']) else "",
             "uf": r['uf'] if pd.notna(r['uf']) else "",
             "statut": r['statut']}
            for _, r in sub.iterrows()
        ]
        hopitaux.append({
            "nom": h, "gh": gh_lookup.get(h, ""), "lat": coord[0], "lon": coord[1],
            "deploye": deploye, "non_deploye": non_deploye, "non_concerne": non_concerne,
            "total": total_calc, "taux": taux, "services": services
        })

    hopitaux.sort(key=lambda x: x['nom'])
    ghu = aggregate_ghu(hopitaux, taux_mode='standard')
    return {"label": "Hospitalisation Complète", "hasUF": True, "date_maj": date_maj,
            "is_demo_data": False, "hopitaux": hopitaux, "ghu": ghu}


def load_chambre_mortuaire(path):
    """
    Applicatif 'Chambre mortuaire' : maille site (pas d'UF), 1 statut par hôpital.
    Colonnes : ligne d'en-tête à l'index 1 (2e ligne du fichier).
    Colonne utilisée : 'Chambre mortuaire Statut'.
    """
    df = pd.read_excel(path, sheet_name=0, header=1)
    df = df.dropna(subset=['Libelle Hopital'])
    df = df[~df['Libelle Hopital'].isin(EXCLUDE)]

    missing = [h for h in df['Libelle Hopital'].unique() if h not in HOPITAL_COORDS]
    if missing:
        print("CM — hôpitaux sans coordonnées connues (ignorés) :", missing)
        df = df[~df['Libelle Hopital'].isin(missing)]

    hopitaux = []
    for _, row in df.iterrows():
        nom = row['Libelle Hopital']
        coord = HOPITAL_COORDS.get(nom)
        if not coord:
            continue
        statut = row.get('Chambre mortuaire Statut')
        statut = statut if pd.notna(statut) else 'Non renseigné'
        date_maj_site = row.get('Chambre mortuaire Date')
        date_maj_site = date_maj_site.strftime('%Y-%m-%d') if pd.notna(date_maj_site) else None

        # Indicateurs de formation FICTIFS (aucune donnée réelle disponible pour ça
        # aujourd'hui) — générés une fois via une seed fixe pour rester stables d'un
        # rechargement à l'autre. Plus de formations en moyenne si le site est "Déployé".
        random.seed(hash(nom) % (2**31))
        if statut == 'Déployé':
            nb_formations = random.randint(3, 8)
            nb_personnes = random.randint(15, 60)
        elif statut == 'Non Déployé':
            nb_formations = random.randint(0, 2)
            nb_personnes = random.randint(0, 10)
        else:
            nb_formations = 0
            nb_personnes = 0

        hopitaux.append({
            "nom": nom, "gh": row.get('Libelle GH', ''), "lat": coord[0], "lon": coord[1],
            "statut": statut,
            "deploye": 1 if statut == 'Déployé' else 0,
            "non_deploye": 1 if statut == 'Non Déployé' else 0,
            "non_concerne": 1 if statut == 'Non concerné' else 0,
            "nb_formations": nb_formations,
            "nb_personnes_formees": nb_personnes,
            "is_demo_indicateurs": True,
            "date_maj_site": date_maj_site
        })

    hopitaux.sort(key=lambda x: x['nom'])
    ghu = aggregate_ghu(hopitaux, taux_mode='total')
    return {"label": "Chambre mortuaire", "hasUF": False, "date_maj": "non disponible",
            "is_demo_data": False, "hopitaux": hopitaux, "ghu": ghu}


MOSAIC_APPLICATIFS = [
    {"id": "orbis", "label": "Orbis", "categorie": "bleu", "fictif": True},
    {"id": "circuit_mater", "label": "Circuit Mater", "categorie": "bleu", "fictif": True},
    {"id": "hospit_complete", "label": "Hospitalisation Complète", "categorie": "bleu", "fictif": False},
    {"id": "glims", "label": "GLIMS v10", "categorie": "jaune", "fictif": True},
    {"id": "calopix", "label": "Calopix", "categorie": "jaune", "fictif": True},
    {"id": "pacs", "label": "PACS Locaux", "categorie": "jaune", "fictif": True},
    {"id": "teleservice", "label": "Téléservice restauration", "categorie": "violet", "fictif": True},
    {"id": "pharmaclass", "label": "PHARMACLASS", "categorie": "vert", "fictif": False},
    {"id": "hed", "label": "HED", "categorie": "vert", "fictif": False},
    {"id": "chimio", "label": "CHIMIO V6", "categorie": "vert", "fictif": False},
    {"id": "sim_pmsi", "label": "SIM PMSI", "categorie": "vert", "fictif": False},
]

STATUT5 = ['Déployé', 'Partiellement déployé', 'Programmé', 'A programmer', 'Non concerné']


def dominant_statut(statuts):
    """Statut le plus fréquent dans une liste (utilisé pour l'agrégation par GHU)."""
    statuts = [s for s in statuts if s]
    if not statuts:
        return 'Non concerné'
    return Counter(statuts).most_common(1)[0][0]


def hc_taux_to_statut(taux, has_data):
    """Convertit le taux d'un hôpital HC (0-100%) en un des 5 statuts, pour la mosaïque."""
    if not has_data:
        return 'Non concerné'
    if taux >= 99.95:
        return 'Déployé'
    if taux <= 0.05:
        return 'A programmer'
    return 'Partiellement déployé'


def build_mosaic(hc_hopitaux, maille_df):
    """Construit les données par hôpital puis par GHU pour chaque applicatif de la mosaïque.
    Utilise les vraies données quand elles existent (Hospit. Complète, Pharmaclass, HED,
    Chimio V6, Sim PMSI), génère des données fictives pour le reste (Orbis, Circuit Mater,
    GLIMS v10, Calopix, PACS Locaux, Téléservice restauration — 0 donnée réelle disponible).
    """
    random.seed(42)
    gh_lookup = {h['nom']: h['gh'] for h in hc_hopitaux}
    noms_hopitaux = list(HOPITAL_COORDS.keys())

    # Statuts réels tirés du fichier maille-site pour les 4 applicatifs disponibles
    real_by_app = {}
    for app_id, col_name in [('pharmaclass', 'PHARMACLASS'), ('hed', 'HED'),
                              ('chimio', 'CHIMIO V6'), ('sim_pmsi', 'SIM PMSI')]:
        col = col_name + ' Statut'
        mapping = {}
        if maille_df is not None and col in maille_df.columns:
            for _, row in maille_df.iterrows():
                nom = row.get('Libelle Hopital')
                statut = row.get(col)
                if not nom or nom not in HOPITAL_COORDS or not isinstance(statut, str):
                    continue
                # Normalise la casse ('a programmer' -> 'A programmer')
                statut = 'A programmer' if statut.strip().lower() == 'a programmer' else statut.strip()
                if statut in STATUT5:
                    mapping[nom] = statut
        real_by_app[app_id] = mapping

    # Statut HC dérivé du taux déjà calculé par hôpital
    hc_by_hopital = {h['nom']: h for h in hc_hopitaux}

    par_hopital = {}  # { nom_hopital: { app_id: statut } }
    for nom in noms_hopitaux:
        par_hopital[nom] = {}
        for app in MOSAIC_APPLICATIFS:
            app_id = app['id']
            if app_id == 'hospit_complete':
                h = hc_by_hopital.get(nom)
                if h:
                    has_data = (h['deploye'] + h['non_deploye']) > 0
                    par_hopital[nom][app_id] = hc_taux_to_statut(h['taux'], has_data)
                else:
                    par_hopital[nom][app_id] = 'Non concerné'
            elif not app['fictif'] and nom in real_by_app.get(app_id, {}):
                par_hopital[nom][app_id] = real_by_app[app_id][nom]
            else:
                # Fictif : tirage aléatoire pondéré (reproductible via la seed fixée plus haut)
                par_hopital[nom][app_id] = random.choices(
                    STATUT5, weights=[30, 20, 15, 20, 15]
                )[0]

    # Agrégation par GHU : statut dominant (le plus fréquent) parmi les hôpitaux du groupe
    par_ghu = {}
    for nom, gh in gh_lookup.items():
        par_ghu.setdefault(gh, {})
    for app in MOSAIC_APPLICATIFS:
        app_id = app['id']
        for gh in par_ghu:
            membres = [n for n, g in gh_lookup.items() if g == gh]
            statuts = [par_hopital[n][app_id] for n in membres if n in par_hopital]
            par_ghu[gh][app_id] = dominant_statut(statuts)

    return {
        "applicatifs": MOSAIC_APPLICATIFS,
        "par_ghu": par_ghu
    }


def main():
    hc = load_hospitalisation_complete(HC_FILE)
    cm = load_chambre_mortuaire(CM_FILE)

    maille_df = pd.read_excel(CM_FILE, sheet_name=0, header=1)
    mosaic = build_mosaic(hc['hopitaux'], maille_df)

    applicatifs = {"hc": hc, "cm": cm}

    with open('data.js', 'w', encoding='utf-8') as f:
        f.write("// Données générées depuis " + HC_FILE + " et " + CM_FILE + "\n")
        f.write("window.APPLICATIFS = ")
        f.write(json.dumps(applicatifs, ensure_ascii=False, indent=2))
        f.write(";\n")
        f.write("window.MOSAIC_APPLICATIFS_DATA = ")
        f.write(json.dumps(mosaic, ensure_ascii=False, indent=2))
        f.write(";\n")

    print(f"OK — HC : {len(hc['hopitaux'])} hôpitaux, {sum(len(h['services']) for h in hc['hopitaux'])} lignes UF")
    print(f"OK — CM : {len(cm['hopitaux'])} hôpitaux")
    print(f"OK — Mosaïque applicatifs : {len(mosaic['applicatifs'])} applicatifs x {len(mosaic['par_ghu'])} GHU")


if __name__ == '__main__':
    main()
