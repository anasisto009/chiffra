# Jeux de données

Générés par `build/build_data.py`, à graine fixe : le corpus est **identique à
chaque exécution**, donc identique pour tous les participants. Aucune donnée
réelle — entreprises, clients, fournisseurs et cabinets sont fictifs.

---

## sujet-01-tenderpilot

| Chemin | Contenu |
|---|---|
| `avis/` | 10 dossiers de consultation en PDF, 7 pages chacun : règlement de la consultation, cahier des prescriptions spéciales, bordereau des prix, planning |
| `avis/AO-2026-004.pdf`, `AO-2026-009.pdf` | **Scans intégraux** : aucune couche texte, OCR obligatoire |
| `profil-entreprise.pdf` / `.json` | Identité, capacités, 24 références couvrant les 6 secteurs, 14 CV |
| `references.csv`, `equipe.csv` | Les mêmes données, exploitables directement |
| `attestations/` | 4 pièces administratives en PDF |
| `offres-passees/` | 2 mémoires techniques déjà rendus — la matière que l'agent doit citer |
| `_jury/` | 2 avis de contrôle non distribués + vérité terrain |

Les exigences sont **dispersées** dans chaque dossier : conditions de
participation au règlement, composition d'équipe au CPS, seuil éliminatoire
dans la grille de notation. Un agent qui ne lit qu'un article en rate.

Sur les 10 dossiers distribués, **6 aboutissent à un go et 4 à un no-go** au regard du profil fourni : un agent qui répondrait systématiquement « non » se trompe six fois sur dix.

## sujet-02-kenza

| Chemin | Contenu |
|---|---|
| `catalogue.csv` | 80 références : modèle, couleur, taille, matière, prix, **stock**, délai de réassort |
| `clients.csv` | 120 clients avec ville, langue préférée, ancienneté, segment |
| `commandes.csv` / `commandes-lignes.csv` | 320 commandes historiques et leur détail — la matière de la mémoire de l'agent |
| `livraison.csv` | Frais, délais, paiement à la livraison et retrait par ville |
| `promotions.csv` | 12 promotions datées |
| `conversations.jsonl` | 40 conversations, 17 intentions distinctes, français / arabe / darija, dont notes vocales et photos |
| `politique-commerciale.md` | Plancher de remise, règles de stock, escalades obligatoires |
| `faq-boutique.md` | Horaires, paiement, retrait, garantie |
| `_jury/` | 12 messages de contrôle et les pièges à tendre en direct |

## sujet-03-chiffra

| Chemin | Contenu |
|---|---|
| `factures/` | 107 pièces sur janvier-juin 2026 : PDF, **scans photocopiés**, photos de reçus, un export Excel |
| `releves/` | 6 relevés bancaires mensuels avec **solde courant**, paiements décalés, partiels et groupés, plus salaires et frais bancaires |
| `referentiel-fournisseurs.csv` | 15 fournisseurs : catégorie, taux habituel, compte, moyenne historique |
| `plan-comptable.csv` | Comptes utilisés |
| `regles-fiscales.md` | Le référentiel applicable, taux et règles de contrôle |
| `_jury/` | Vérité terrain complète et inventaire des documents |

Le corpus contient des avoirs, des factures non rapprochées, des paiements
partiels et groupés, et des lignes bancaires qui ne correspondent à aucune
facture — salaires, frais, règlements clients. Les signaler serait un faux
positif.

---

## Avant distribution

**Retirer les dossiers `_jury/`.** Ils contiennent la vérité terrain et les
jeux de contrôle : distribués par erreur, ils vident l'épreuve de son sens.

```bash
find livrables/jeux-de-donnees -name _jury -type d -exec rm -rf {} +
```

## Régénérer

```bash
python3 build/build_data.py
```
