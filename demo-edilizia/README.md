# EDILIA — dimostrativo gestionale per l'edilizia

**DEMO NON DEFINITIVA — dati completamente inventati.**

Prototipo navigabile per presentare al titolare la possibile evoluzione di un gestionale per cantieri, artigiani e contabilità.

## Apri subito la demo
[Apri il dimostrativo nel browser](https://htmlpreview.github.io/?https://github.com/Terracotta97/crm-su-misura-/blob/demo-gestionale-edilizia/demo-edilizia/index.html)

Per evitare la dipendenza da un servizio di anteprima esterno, puoi anche [scaricare index.html](https://raw.githubusercontent.com/Terracotta97/crm-su-misura-/demo-gestionale-edilizia/demo-edilizia/index.html) e aprire il file con Chrome, Firefox o Edge.

La demo è composta da un solo file HTML autonomo, senza bisogno di installazione, Cloudflare o credenziali.

## Cosa puoi provare

- **Panoramica:** cantieri attivi, valori contrattuali, costi e debiti verso artigiani.
- **Cantieri:** schede modificabili, avanzamento, valore iniziale e varianti, cantieri conclusi e archivio automatico dopo 12 mesi; i cantieri aperti restano sempre visibili.
- **Calendario per cantiere:** navigazione mensile, apertura di ogni data, programmazione presenze future e conferma delle giornate effettive.
- **Pulsante ＋ Aggiungi:** artigiani, dipendenti, materiali, spese, noleggi, lavorazioni, note, fatture e pagamenti.
- **Artigiani e personale:** modalità di pagamento a giornata, a ore, a misura o a corpo; costo maturato, acconti, saldo da pagare e movimenti su più cantieri.
- **Contabilità per cantiere:** contratto, varianti, spese per categoria, margine provvisorio e pagamenti; fatture collegate a costi già registrati senza doppio conteggio.
- **Documenti:** DDT cartacei fotografati, PDF, fatture e ricevute allegabili alle registrazioni.
- **Dimostrazione funzionante:** tutte le nuove registrazioni rimangono in memoria nel browser (localStorage); eventuali file sono tenuti localmente in IndexedDB se disponibile.

### Prova in 60 secondi

1. Apri **Calendario e giornate**.
2. Seleziona **Cantiere Villa Rossi** e scegli una data.
3. Clicca **＋ Aggiungi** e scegli **Materiale / acquisto**.
4. Inserisci descrizione, fornitore, quantità e importo; scegli **Bolla / DDT** e salva.
5. Apri **Contabilità**: il costo è stato sommato.
6. Aggiungi una **Fattura collegata a costo già esistente** e seleziona quella spesa: il costo non viene duplicato.
7. Apri **Artigiani e personale** e prova un **Pagamento a un artigiano**: il saldo cambia senza aumentare il costo.
8. Premi **Ripristina esempi** per ricominciare.

## Limiti intenzionali

È un dimostrativo di interfaccia e logica di base, **non pronto per uso aziendale**. Non dispone di login, database centralizzato, gestione multiutente, sincronizzazione tra telefoni, backup cloud, emissione fatture, fiscalità/IVA, tracciamento completo SAL, sicurezza o audit. Non caricare dati reali o documenti sensibili: nel prototipo sono memorizzati nel browser locale e, se usi un servizio di anteprima, l'HTML viene caricato tramite tale servizio.

## Codice originale preservato

Questo progetto è ospitato esclusivamente nel branch \`demo-gestionale-edilizia\`, nella directory \`demo-edilizia/\`. Il branch \`main\` e il gestionale originale **non sono stati modificati**.
