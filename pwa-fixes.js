// ==========================================
// FIXES PARA PWA Y ANDROID (Sweetly Music)
// ==========================================

// 1. Control del botón "Atrás" de Android para vistas/letras sin detener el audio
window.addEventListener('popstate', function(event) {
    // Busca si tienes algún modal, pantalla de letras o reproductor expandido abierto
    const modalReproductor = document.getElementById('seccion-reproductor'); // Cambia al ID real de tu reproductor si es diferente
    const modalLetras = document.getElementById('seccion-letras');       // Cambia al ID real de tus letras si aplica

    if (modalLetras && modalLetras.style.display === 'block') {
        modalLetras.style.display = 'none';
        history.pushState(null, '', location.href); // Mantiene el estado activo
        event.preventDefault();
        return;
    }

    if (modalReproductor && modalReproductor.classList.contains('activo')) {
        modalReproductor.classList.remove('activo');
        history.pushState(null, '', location.href);
        event.preventDefault();
        return;
    }
});

// 2. Control de Media Session para pausar/reproducir con controles de sistema o audífonos
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('pause', function() {
        const audioElement = document.querySelector('audio'); // Detecta tu etiqueta de audio principal
        if (audioElement && !audioElement.paused) {
            audioElement.pause();
        }
    });
    
    navigator.mediaSession.setActionHandler('play', function() {
        const audioElement = document.querySelector('audio');
        if (audioElement && audioElement.paused) {
            audioElement.play();
        }
    });
}