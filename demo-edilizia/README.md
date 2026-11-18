# Global Technology — dimostrativo gestionale per l'edilizia

**DEMO NON DEFINITIVA — dati completamente inventati.**

Prototipo navigabile per presentare al titolare la possibile evoluzione di un gestionale per cantieri, artigiani e contabilità.

## Apri subito la demo
[Apri il dimostrativo nel browser](https://htmlpreview.github.io/?https://github.com/Terracotta97/crm-su-misura-/blob/demo-gestionale-edilizia/demo-edilizia/index.html)

Per evitare la dipendenza da un servizio di anteprima esterno, puoi anche [scaricare index.html](https://raw.githubusercontent.com/Terracotta97/crm-su-misura-/demo-gestionale-edilizia/demo-edilizia/index.html) e aprire il file con Chrome, Firefox o Edge.

La demo è composta da un solo file HTML autonomo, senza bisogno di installazione, Cloudflare o credenziali.

## Cosa puoi provare

- **Panoramica:** cantieri attivi, valori contrattuali, costi e debiti verso artigiani.
- **Cantieri:** elenco compatto ordinato per data di inserimento (più recenti prima), schede modificabili, avanzamento, valore iniziale e varianti, conclusi e archivio dopo 12 mesi; i cantieri aperti restano sempre visibili.
- **Calendario per cantiere:** navigazione mensile, apertura di ogni data, programmazione presenze future e conferma delle giornate effettive.
- **Pulsante ＋ Aggiungi:** artigiani, dipendenti, materiali, spese, noleggi, lavorazioni, note, fatture e pagamenti, con conferma al salvataggio e aggiornamento della giornata.
- **Artigiani e personale:** modalità di pagamento a giornata, a ore, a misura o a corpo; costo maturato, acconti, saldo da pagare e movimenti su più cantieri.
- **Pagamenti artigiani:** nuova voce di menu, con filtro tra lavorazioni ancora da saldare e pagamenti già effettuati, storico dettagliato per artigiano e registrazione acconti.
- **Contabilità per cantiere:** contratto, varianti, spese per categoria, margine provvisorio e pagamenti; fatture collegate a costi già registrati senza doppio conteggio.
- **Documenti ricevuti:** DDT cartacei fotografati, PDF, fatture e ricevute allegabili alle registrazioni.
- **Leasing e noleggi:** contratti con ditta, mezzo, cantiere collegato, canone, periodicità, date, prossima scadenza, rata pagata e storico dei costi. Le scadenze future non generano costi automatici.
- **Bolle / DDT da creare:** nuovo menu per redigere documenti dimostrativi con progressivo annuale, destinatario, cantiere, causale, trasporto e più righe materiale. Anteprima e stampa / salva in PDF dal browser, con dicitura fac-simile.
- **Dimostrazione funzionante:** tutte le nuove registrazioni rimangono in memoria nel browser (localStorage); eventuali file sono tenuti localmente in IndexedDB se disponibile.

### Prova in 60 secondi

1. Apri **Calendario e giornate**.
2. Seleziona **Cantiere Villa Rossi** e scegli una data.
3. Clicca **＋ Aggiungi** e scegli **Materiale / acquisto**.
4. Inserisci descrizione, fornitore, quantità e importo; scegli **Bolla / DDT** e salva.
5. Apri **Contabilità**: il costo è stato sommato.
6. Aggiungi una **Fattura collegata a costo già esistente** e seleziona quella spesa: il costo non viene duplicato.
7. Apri **Artigiani e personale** e prova un **Pagamento a un artigiano**: il saldo cambia senza aumentare il costo.
8. Apri **Pagamenti artigiani** per distinguere quanto è già stato versato da quanto resta da saldare.
9. Apri **Leasing e noleggi**, aggiungi un contratto e registra una rata: il costo compare sul cantiere associato.
10. Apri **Bolle / DDT da creare**, compila una bolla con i materiali e apri l'anteprima per salvarla in PDF tramite la stampa del browser.
11. Premi **Ripristina esempi** per ricominciare.

## Limiti intenzionali

È un dimostrativo di interfaccia e logica di base, **non pronto per uso aziendale**. Non dispone di login, database centralizzato, gestione multiutente, sincronizzazione tra telefoni, backup cloud, emissione fatture, fiscalità/IVA, emissione legalmente validata di DDT, tracciamento completo SAL, sicurezza o audit. Non caricare dati reali o documenti sensibili: nel prototipo sono memorizzati nel browser locale e, se usi un servizio di anteprima, l'HTML viene caricato tramite tale servizio.

## Codice originale preservato

Questo progetto è ospitato esclusivamente nel branch \`demo-gestionale-edilizia\`, nella directory \`demo-edilizia/\`. Il branch \`main\` e il gestionale originale **non sono stati modificati**.

## Identità aziendale e verifica

- Logo e palette blu di **Global Technology** (Edilizia, Impianti, Infissi).
- Campi di inserimento data gestiti nei cantieri nuovi e negli esempi; per vecchie registrazioni prive di data il sistema dichiara il dato mancante senza inventarlo.
- Test automatico GitHub Actions con DOM simulato per aggiunta cantiere, materiali, presenze, pagamenti, gestione leasing e creazione di una bolla / DDT.
