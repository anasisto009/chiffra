# Référentiel de règles applicables

Ce référentiel fait foi. Les participants n'ont pas à inventer la règle
fiscale : elle est ici.

## Taux de TVA
| Taux | Champ d'application |
|---|---|
| 20% | Taux normal — la majorité des biens et services |
| 14% | Transport de marchandises et de voyageurs, énergie |
| 10% | Restauration, hôtellerie, opérations bancaires |
| 7% | Produits de première nécessité, eau, fournitures scolaires |

Le taux applicable dépend de la **catégorie du fournisseur**, donnée dans
`referentiel-fournisseurs.csv`. Un taux différent du taux habituel de la
catégorie est une anomalie de TVA.

## Mentions obligatoires
1. L'ICE du fournisseur **et** celui du client doivent figurer sur la facture.
2. La facture doit porter un numéro, une date, et le détail HT / TVA / TTC.
3. Une facture sans ICE fournisseur n'ouvre pas droit à déduction.

## Période
4. L'exercice couvert est **du 1er janvier au 30 juin 2026**. Une pièce datée
   hors de cette période n'est pas imputable sur l'exercice.

## Doublons
5. Deux pièces du même fournisseur, de même montant TTC, dont les dates sont
   espacées de moins de sept jours, constituent un **doublon probable**.
6. Deux pièces strictement identiques constituent un **doublon exact**.

## Montants aberrants
7. Un montant supérieur à **dix fois** la moyenne historique du fournisseur
   (colonne `montant_moyen_ttc_mad`) est aberrant et doit être signalé.

## Avoirs
8. Un avoir vient **en déduction** du compte fournisseur. Il porte un montant
   négatif et doit être rapproché de la facture d'origine.

## Rapprochement bancaire
9. Un paiement peut intervenir jusqu'à 60 jours après la date de facture.
10. Une ligne bancaire peut couvrir **plusieurs** factures (paiement groupé).
11. Un paiement peut être **partiel** : le solde reste dû.
12. Les lignes de salaires, frais bancaires et règlements clients ne se
    rapprochent d'aucune facture d'achat : elles doivent être ignorées, pas
    signalées comme anomalies.
