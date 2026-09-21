// Lecture du code-barres ISBN par la camera.
//
// BarcodeDetector est natif sur Chrome Android, c'est-a-dire exactement la
// cible du projet. Ailleurs (iOS, Firefox) la fonction est absente : l'appel
// echoue proprement et l'interface propose la saisie du numero a la main.

export const scanDisponible = () =>
  'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia !== undefined;

/**
 * Affiche le flux camera dans <video> et resout au premier EAN-13 lu.
 * Renvoie une fonction d'arret a appeler si l'utilisateur annule.
 */
export function demarrerScan(video, surCode) {
  let flux = null;
  let actif = true;

  const arreter = () => {
    actif = false;
    flux?.getTracks().forEach((piste) => piste.stop());
    video.srcObject = null;
  };

  (async () => {
    const detecteur = new BarcodeDetector({ formats: ['ean_13'] });
    flux = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    if (!actif) return flux.getTracks().forEach((p) => p.stop());

    video.srcObject = flux;
    await video.play();

    while (actif) {
      try {
        const [code] = await detecteur.detect(video);
        if (code?.rawValue) {
          arreter();
          surCode(code.rawValue);
          return;
        }
      } catch {
        // Image illisible sur cette frame : on retente au tour suivant.
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  })().catch((err) => {
    arreter();
    surCode(null, err);
  });

  return arreter;
}
