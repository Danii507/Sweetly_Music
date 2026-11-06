/* ==========================================================================
   DANII MUSIC - APP LOGIC & DATA ENGINE
   ========================================================================== */

// 1. CONFIGURACIÓN DE TU GOOGLE SHEETS
// Reemplaza este ID por el ID de tu hoja de Google Sheets.
// Lo encuentras en la URL de tu hoja: https://docs.google.com/spreadsheets/d/TU_SHEET_ID_AQUI/edit
const GOOGLE_SHEET_ID = '1fS_JOtJBbpn_bQBOFm1EbjBmN1peFZ8YKdrRzH0wtnc';

// Enlaces de tus hojas/pestañas exportadas (reemplaza los nombres de pestaña si difieren)
const URL_SHEET_ARTISTS = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Artistas`;
const URL_SHEET_ALBUMS  = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Albumes`;
const URL_SHEET_SONGS   = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Canciones`;
const URL_SHEET_BANNERS = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Banners`;

// ESTADO GENERAL Y ESTRUCTURA DE BASE DE DATOS
let db = {
    artists: [],
    albums: [],
    songs: [],
    bannerImages: []
};

let currentPlaylist = [];
let currentTrackIndex = 0;
let isPlaying = false;
let currentDetailContext = [];
let navigationHistory = ['library'];
let parsedLyrics = []; // Almacena las marcas de tiempo de la letra activa (.lrc)

const audio = document.getElementById('audioElement');

/* ==========================================================================
   2. INICIALIZACIÓN
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    updateGreeting();
    
    // Carga los datos de Google Sheets o usa datos locales de respaldo si aún no pones tu ID
    await loadDataFromGoogleSheets();

    renderAllViews();
    loadRandomBannerImage();
    setupAudioListeners();
    lucide.createIcons();
});

/* ==========================================================================
   3. CÓDIGO CONECTOR Y PARSER DE GOOGLE SHEETS
   ========================================================================== */
async function loadDataFromGoogleSheets() {
    if (GOOGLE_SHEET_ID === 'TU_SHEET_ID_AQUI') {
        console.warn("DaniiMusic: No has colocado tu GOOGLE_SHEET_ID. Cargando datos demo locales.");
        loadMockData();
        return;
    }

    try {
        const [artistsRes, albumsRes, songsRes, bannersRes] = await Promise.all([
            fetch(URL_SHEET_ARTISTS).then(r => r.text()),
            fetch(URL_SHEET_ALBUMS).then(r => r.text()),
            fetch(URL_SHEET_SONGS).then(r => r.text()),
            fetch(URL_SHEET_BANNERS).then(r => r.text()).catch(() => null)
        ]);

        db.artists = parseGoogleSheetJSON(artistsRes, row => ({
            id: parseInt(row.id || row.ID),
            name: String(row.name || row.Nombre || row.nombre),
            image: transformDriveUrl(row.image || row.Image || row.foto_url)
        }));

        db.albums = parseGoogleSheetJSON(albumsRes, row => ({
            id: parseInt(row.id || row.ID),
            title: String(row.title || row.Title || row.titulo),
            artistId: parseInt(row.artistid || row.ArtistId || row.artista_id),
            cover: transformDriveUrl(row.cover || row.Cover || row.portada_url)
        }));

        db.songs = parseGoogleSheetJSON(songsRes, row => ({
            id: parseInt(row.id || row.ID),
            title: String(row.title || row.Title || row.titulo),
            artistId: parseInt(row.artistid || row.ArtistId || row.artista_id),
            albumId: parseInt(row.albumid || row.AlbumId || row.album_id),
            duration: String(row.duration || row.Duration || row.duracion || "3:30"),
            format: String(row.format || row.Format || row.formato || "FLAC"),
            url: transformDriveUrl(row.url || row.Url || row.audio_url),
            lyrics: row.lyrics || row.Lyrics || row.letra || ""
        }));

        if (bannersRes) {
            const parsedBanners = parseGoogleSheetJSON(bannersRes, row => {
                let rawUrl = row.url || row.Url || row.URL || row.image || row.Image || row.foto_url || "";
                if (typeof row === 'string') rawUrl = row;
                return transformDriveUrl(rawUrl);
            }).filter(url => url && url.trim() !== "");

            if (parsedBanners.length > 0) {
                db.bannerImages = parsedBanners;
                loadRandomBannerImage(); // Pinta el banner de inmediato al terminar de cargar
            }
        }
    } catch (error) {
        console.error("Error cargando Google Sheets, usando respaldo local:", error);
        loadMockData();
    }
}

// Auxiliar para limpiar la respuesta gviz/tq JSON de Google Sheets
function parseGoogleSheetJSON(responseText, transformFn) {
    try {
        const jsonString = responseText.substring(responseText.indexOf("{"), responseText.lastIndexOf("}") + 1);
        const data = JSON.parse(jsonString);
        const cols = data.table.cols.map(col => col.label);
        return data.table.rows.map(row => {
            const rowObj = {};
            row.c.forEach((cell, index) => {
                const key = cols[index];
                if (key) {
                    rowObj[key] = cell ? cell.v : "";
                }
            });
            return transformFn(rowObj);
        });
    } catch (e) {
        console.error("Error parseando tabla JSON:", e);
        return [];
    }
}

// Convertidor automático de links para soportar enlaces directos web y de Drive
function transformDriveUrl(url) {
    if (!url) return "";
    const strUrl = String(url).trim();
    
    // Si ya es un enlace web directo o de CDN (como jsDelivr o imágenes públicas), devuélvelo intacto
    if (strUrl.startsWith('http://') || strUrl.startsWith('https://')) {
        if (!strUrl.includes('drive.google.com')) {
            return strUrl;
        }
    }

    if (strUrl.includes('drive.google.com') && strUrl.includes('id=')) {
        const id = strUrl.split('id=')[1].split('&')[0];
        return `https://drive.google.com/uc?export=view&id=${id}`;
    }
    if (strUrl.includes('drive.google.com/file/d/')) {
        const id = strUrl.split('/d/')[1].split('/')[0];
        return `https://drive.google.com/uc?export=view&id=${id}`;
    }
    return strUrl;
}

/* ==========================================================================
   4. MANEJO DE LETRAS PARSEADAS (.LRC) Y SINCRONIZACIÓN
   ========================================================================== */
function parseLRC(lrcText) {
    if (!lrcText) return [];
    const lines = String(lrcText).split('\n');
    const result = [];
    const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    lines.forEach(line => {
        const match = timeReg.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3], 10) / (match[3].length === 3 ? 1000 : 100);
            const totalSeconds = (minutes * 60) + seconds + milliseconds;
            const text = line.replace(timeReg, '').trim();
            if (text) {
                result.push({ time: totalSeconds, text: text });
            }
        }
    });

    return result.sort((a, b) => a.time - b.time);
}

function setupAudioListeners() {
    // Sincronizar la barra de tiempo y el avance de la letra LRC
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;

        // Barra de progreso y tiempos
        const currentTime = audio.currentTime;
        const totalTime = audio.duration;
        const progressPercent = (currentTime / totalTime) * 100;

        const progressBar = document.getElementById('progressBar');
        if (progressBar) progressBar.value = progressPercent;

        document.getElementById('currentTime').innerText = formatTime(currentTime);
        document.getElementById('totalTime').innerText = formatTime(totalTime);

        // Sincronización visual de la Letras (.lrc)
        if (parsedLyrics.length > 0) {
            let activeIndex = -1;
            for (let i = 0; i < parsedLyrics.length; i++) {
                if (parsedLyrics[i].time <= currentTime) {
                    activeIndex = i;
                } else {
                    break;
                }
            }

            const lyricsContainer = document.getElementById('lyricsText');
            if (lyricsContainer && activeIndex !== -1) {
                const linesElements = lyricsContainer.querySelectorAll('.lyric-line');
                linesElements.forEach((el, idx) => {
                    if (idx === activeIndex) {
                        el.style.opacity = '1';
                        el.style.fontWeight = '700';
                        el.style.color = 'var(--accent-pink-dark)';
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        el.style.opacity = '0.35';
                        el.style.fontWeight = '500';
                        el.style.color = 'var(--text-primary)';
                    }
                });
            }
        }
    });

    // Auto siguiente canción al terminar
    audio.addEventListener('ended', () => {
        nextSong();
    });
}

function renderLyricsView(lyricsString) {
    const container = document.getElementById('lyricsText');
    if (!lyricsString || lyricsString.trim() === "") {
        container.innerHTML = "<div style='text-align:center; color:var(--text-secondary); margin-top:40px;'>No hay letras disponibles.</div>";
        parsedLyrics = [];
        return;
    }

    const lines = lyricsString.split('\n');
    parsedLyrics = [];
    const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    container.innerHTML = lines.map((line, index) => {
        const match = timeReg.exec(line);
        let textContent = line;

        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const millis = parseInt(match[3].padEnd(3, '0'), 10);
            const timeInSeconds = minutes * 60 + seconds + millis / 1000;
            
            // Extrae el texto limpio descartando el código de tiempo visualmente
            textContent = line.replace(timeReg, '').trim();
            parsedLyrics.push({ time: timeInSeconds, text: textContent });
        } else {
            textContent = line.trim();
            parsedLyrics.push({ time: 0, text: textContent });
        }

        if (textContent === "") {
            return `<div class="lyric-line" id="lyric-${index}" style="height: 14px;"></div>`;
        }
        
        return `<div class="lyric-line" id="lyric-${index}">${textContent}</div>`;
    }).join('');
}

/* ==========================================================================
   5. CONTROL DE TEMAS Y SALUDOS PERSONALIZADOS
   ========================================================================== */
function initTheme() {
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 18;
    setTheme(isNight);
}

function setTheme(isDark) {
    const body = document.body;
    const themeBtn = document.getElementById('themeToggleBtn');
    
    if (isDark) {
        body.classList.add('dark-theme');
        themeBtn.innerHTML = '<i data-lucide="sun"></i>';
    } else {
        body.classList.remove('dark-theme');
        themeBtn.innerHTML = '<i data-lucide="moon"></i>';
    }
    lucide.createIcons();
}

document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark-theme');
    setTheme(!isDark);
});

function updateGreeting() {
    const hour = new Date().getHours();
    let text = "Buenas noches, Rachel";
    if (hour >= 6 && hour < 12) text = "Buenos días, Rachel";
    else if (hour >= 12 && hour < 18) text = "Buenas tardes, Rachel";
    
    document.getElementById('greetingText').innerText = text;
}

function loadRandomBannerImage() {
    if (!db.bannerImages || db.bannerImages.length === 0) return;
    
    // Selecciona una imagen aleatoria de la lista
    const randomImg = db.bannerImages[Math.floor(Math.random() * db.bannerImages.length)];
    
    const bannerElement = document.getElementById('bannerArtistImg');
    if (bannerElement && randomImg) {
        // Asigna la URL directamente al elemento de imagen
        bannerElement.src = String(randomImg).trim();
    }
}

/* ==========================================================================
   6. NAVEGACIÓN Y BOTÓN DE RETORNO NATIVO
   ========================================================================== */
function switchView(viewName, isBackAction = false) {
    if (!isBackAction) {
        navigationHistory.push(viewName);
        history.pushState({ view: viewName }, '', '');
    }
    
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    
    const backBtn = document.getElementById('backBtn');
    const greetingBanner = document.getElementById('greetingBanner');

    if (viewName === 'library') {
        const libView = document.getElementById('viewLibrary');
        if (libView) libView.classList.add('active');
        const pageTitle = document.getElementById('pageTitle');
        if (pageTitle) pageTitle.innerText = "Biblioteca";
        if (backBtn) backBtn.classList.add('hidden');
        if (greetingBanner) greetingBanner.style.display = 'flex';
    } else {
        if (backBtn) backBtn.classList.remove('hidden');
        if (greetingBanner) greetingBanner.style.display = 'none';
    }

    if (viewName === 'artists') {
        document.getElementById('viewArtists')?.classList.add('active');
        document.getElementById('pageTitle').innerText = "Artistas";
    } else if (viewName === 'albums') {
        document.getElementById('viewAlbums')?.classList.add('active');
        document.getElementById('pageTitle').innerText = "Álbumes";
    } else if (viewName === 'songs') {
        document.getElementById('viewSongs')?.classList.add('active');
        document.getElementById('pageTitle').innerText = "Canciones";
    } else if (viewName === 'detail') {
        document.getElementById('viewDetail')?.classList.add('active');
    }
}

function goBack() {
    if (navigationHistory.length > 1) {
        navigationHistory.pop();
        const previousView = navigationHistory[navigationHistory.length - 1];
        switchView(previousView, true);
    }
}

/* ==========================================================================
   7. RENDERS DE CONTENIDO E INTERFAZ
   ========================================================================== */
function renderAllViews() {
    renderTop50();
    renderArtists();
    renderAlbums();
    renderSongs();
}

function renderTop50() {
    const container = document.getElementById('top50Container');
    const top50 = db.songs.slice(0, 50);

    container.innerHTML = top50.map(song => {
        const album = db.albums.find(a => a.id === song.albumId);
        return `
            <div class="top50-card" onclick="playSingleSong(${song.id})">
                <img src="${album ? album.cover : ''}" alt="Portada">
                <div class="title">${song.title}</div>
                <div class="subtitle">${getArtistName(song.artistId)}</div>
            </div>
        `;
    }).join('');
}

function renderArtists() {
    const container = document.getElementById('artistList');
    container.innerHTML = db.artists.map(artist => `
        <div class="list-row artist-row" onclick="openArtistDetail(${artist.id})">
            <img src="${artist.image}" alt="${artist.name}">
            <div class="list-row-info">
                <div class="main-text">${artist.name}</div>
            </div>
            <i data-lucide="chevron-right" class="arrow-icon"></i>
        </div>
    `).join('');
    lucide.createIcons();
}

function renderAlbums() {
    const container = document.getElementById('albumGrid');
    container.innerHTML = db.albums.map(album => `
        <div class="grid-card" onclick="openAlbumDetail(${album.id})">
            <img src="${album.cover}" alt="${album.title}">
            <div class="main-text">${album.title}</div>
            <div class="sub-text">${getArtistName(album.artistId)}</div>
        </div>
    `).join('');
}

function renderSongs() {
    const container = document.getElementById('songList');
    container.innerHTML = db.songs.map(song => {
        const album = db.albums.find(a => a.id === song.albumId);
        const coverUrl = album ? album.cover : "";
        return `
            <div class="list-row song-row" onclick="playSingleSong(${song.id})">
                <img src="${coverUrl}" alt="Portada" class="song-thumb">
                <div class="list-row-info">
                    <div class="main-text">${song.title}</div>
                    <div class="sub-text">${getArtistName(song.artistId)} • ${song.duration}</div>
                </div>
            </div>
        `;
    }).join("");
    lucide.createIcons();
}

/* ==========================================================================
   8. DETALLES DE ÁLBUM / ARTISTA (SIN AUTO-REPRODUCCIÓN AL ABRIR)
   ========================================================================== */
function openAlbumDetail(albumId) {
    const album = db.albums.find(a => a.id === albumId);
    currentDetailContext = db.songs.filter(s => s.albumId === albumId);

    document.getElementById('detailCover').src = album ? album.cover : '';
    document.getElementById('detailTitle').innerText = album ? album.title : 'Álbum';
    document.getElementById('detailSubtitle').innerText = album ? getArtistName(album.artistId) : '';
    document.getElementById('pageTitle').innerText = "Álbum";
    
    renderDetailSongList(currentDetailContext);
    switchView('detail');
}

function openArtistDetail(artistId) {
    const artist = db.artists.find(a => a.id === artistId);
    currentDetailContext = db.songs.filter(s => s.artistId === artistId);

    document.getElementById('detailCover').src = artist ? artist.image : '';
    document.getElementById('detailTitle').innerText = artist ? artist.name : 'Artista';
    document.getElementById('detailSubtitle').innerText = "Artista";
    document.getElementById('pageTitle').innerText = "Artista";

    renderDetailSongList(currentDetailContext);
    switchView('detail');
}

function renderDetailSongList(songs) {
    const container = document.getElementById('detailSongList');
    container.innerHTML = songs.map(song => `
        <div class="list-row" onclick="playSongFromContext(${song.id})">
            <div class="list-row-info">
                <div class="main-text">${song.title}</div>
                <div class="sub-text">${song.duration}</div>
            </div>
        </div>
    `).join('');
}

/* ==========================================================================
   9. MOTOR DE REPRODUCCIÓN Y CONTROLADORES
   ========================================================================== */
function playSingleSong(songId) {
    currentPlaylist = [...db.songs];
    currentTrackIndex = currentPlaylist.findIndex(s => s.id === songId);
    loadAndPlayTrack();
}

function playSongFromContext(songId) {
    currentPlaylist = [...currentDetailContext];
    currentTrackIndex = currentPlaylist.findIndex(s => s.id === songId);
    loadAndPlayTrack();
}

function playAllSongs(shuffle = false) {
    currentPlaylist = [...db.songs];
    if (shuffle) shuffleArray(currentPlaylist);
    currentTrackIndex = 0;
    loadAndPlayTrack();
}

function playCurrentDetailContext(shuffle = false) {
    if (currentDetailContext.length === 0) return;
    currentPlaylist = [...currentDetailContext];
    if (shuffle) shuffleArray(currentPlaylist);
    currentTrackIndex = 0;
    loadAndPlayTrack();
}

function loadAndPlayTrack(index) {
    // Si pasamos un índice por parámetro (desde la lista), actualizamos el índice actual
    if (typeof index !== 'undefined') {
        currentTrackIndex = index;
    }

    const track = currentPlaylist[currentTrackIndex];
    if (!track) {
        console.error("No hay ninguna pista seleccionada en la lista actual.");
        return;
    }

    // Validación crítica: Asegurarnos de que la URL de Cloudflare R2 exista
    if (!track.url) {
        console.error("La canción no tiene una URL válida asignada:", track);
        return;
    }

    const album = db.albums.find(a => a.id === track.albumId);
    const coverImg = album ? album.cover : "";
    
    // Asignamos la URL de Cloudflare R2 al elemento de audio
    audio.src = track.url;
    audio.load(); // Fuerza al navegador a cargar el stream de audio

    // Mini Player
    document.getElementById('miniTitle').innerText = track.title;
    document.getElementById('miniArtist').innerText = getArtistName(track.artistId);
    document.getElementById('miniCover').src = coverImg;
    document.getElementById('miniPlayer').classList.remove('hidden');

    // Full Player Modal
    document.getElementById('playerTitle').innerText = track.title;
    document.getElementById('playerArtist').innerText = getArtistName(track.artistId);
    document.getElementById('playerCover').src = coverImg;
    document.getElementById('playerThumb').src = coverImg;
    document.getElementById('playerFormatBadge').innerText = track.format || 'FLAC';

    // Renderizado seguro de letras
    if (track.lyrics) {
        if (track.lyrics.startsWith('http')) {
            fetch(track.lyrics)
                .then(res => res.text())
                .then(lyricsText => renderLyricsView(lyricsText))
                .catch(err => {
                    console.error("Error al cargar letras:", err);
                    renderLyricsView("No se pudieron cargar las letras.");
                });
        } else {
            renderLyricsView(track.lyrics);
        }
    } else {
        renderLyricsView("");
    }

    // Intentamos reproducir el audio manejando posibles bloqueos del navegador
    audio.play().then(() => {
        isPlaying = true;
        updatePlayIcons();
        setupMediaSession(track, album);
    }).catch(error => {
        console.error("El navegador bloqueó la reproducción automática o hubo un error con el archivo:", error);
        isPlaying = false;
        updatePlayIcons();
    });
}

function togglePlay() {
    if (!audio.src) return;
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
    } else {
        audio.play();
        isPlaying = true;
    }
    updatePlayIcons();
}

function updatePlayIcons() {
    const iconName = isPlaying ? 'pause' : 'play';
    document.getElementById('miniPlayIcon').setAttribute('data-lucide', iconName);
    document.getElementById('mainPlayIcon').setAttribute('data-lucide', iconName);
    lucide.createIcons();
}

function nextSong() {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    loadAndPlayTrack();
}

function prevSong() {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    loadAndPlayTrack();
}

function seekAudio(percent) {
    if (!audio.duration) return;
    audio.currentTime = (percent / 100) * audio.duration;
}

// CONTROL DE MODALES DE REPRODUCTOR
function openFullPlayer() {
    if (!audio.src) return;
    const fullPlayer = document.getElementById('fullPlayer');
    if (fullPlayer) {
        fullPlayer.classList.add('active');
        history.pushState({ view: 'player' }, '', '');
    }
}

// Control inteligente del botón de la flecha hacia abajo
function closeFullPlayer() {
    const fullPlayer = document.getElementById('fullPlayer');
    if (!fullPlayer) return;

    // Si las letras están activas, las cerramos primero
    if (fullPlayer.classList.contains('lyrics-active')) {
        toggleLyricsView();
        return;
    }

    // Cierra el reproductor completo
    fullPlayer.classList.remove('active');
}

// Control del botón de letras (icono de comillas/quotes)
function toggleLyricsView() {
    const fullPlayer = document.getElementById('fullPlayer');
    const lyricsContainer = document.getElementById('lyricsContainer');
    
    // Alterna el modo letras estilo Spotify
    fullPlayer.classList.toggle('lyrics-active');
    lyricsContainer.classList.toggle('hidden');
}

/* ==========================================================================
   10. INTEGRA NOTIFICACIONES Y PANTALLA DE BLOQUEO (ANDROID APK)
   ========================================================================== */
function setupMediaSession(track, album) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: getArtistName(track.artistId),
            album: album ? album.title : '',
            artwork: [
                { src: album ? album.cover : '', sizes: '512x512', type: 'image/jpeg' }
            ]
        });

        navigator.mediaSession.setActionHandler('play', () => togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
        navigator.mediaSession.setActionHandler('nexttrack', () => nextSong());
    }
}

/* ==========================================================================
   11. DATOS DE RESPALDO (DEMO LOCAL)
   ========================================================================== */
function loadMockData() {
    db.bannerImages = [
        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500",
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500"
    ];

    db.artists = [
        { id: 1, name: "Daft Punk", image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500" },
        { id: 2, name: "Travis Scott", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=500" }
    ];

    db.albums = [
        { id: 101, title: "Random Access Memories", artistId: 1, cover: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=500" },
        { id: 102, title: "ASTROWORLD", artistId: 2, cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500" }
    ];

    db.songs = [
        { 
            id: 1001, 
            title: "STARGAZING", 
            artistId: 2, 
            albumId: 102, 
            duration: "4:31", 
            format: "FLAC", 
            url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", 
            lyrics: "[00:00.00] STARGAZING - Travis Scott\n[00:05.00] Rollin' rollin' rollin' got me stargazing\n[00:12.00] Psychedelics got me goin' crazy" 
        },
        { 
            id: 1002, 
            title: "Get Lucky", 
            artistId: 1, 
            albumId: 101, 
            duration: "4:08", 
            format: "FLAC", 
            url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", 
            lyrics: "[00:00.00] Get Lucky - Daft Punk\n[00:10.00] Like the legend of the phoenix\n[00:18.00] All ends with beginnings" 
        }
    ];
}

/* ==========================================================================
   12. UTILIDADES
   ========================================================================== */
function getArtistName(artistId) {
    const artist = db.artists.find(a => a.id === artistId);
    return artist ? artist.name : "Desconocido";
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// ==========================================
// CONTROL DE HISTORIAL Y BOTÓN ATRÁS (NATIVO)
// ==========================================
window.addEventListener('popstate', function(event) {
    const fullPlayer = document.getElementById('fullPlayer');
    
    // 1. Si las letras están abiertas, ciérralas primero y regresa al reproductor
    if (fullPlayer && fullPlayer.classList.contains('lyrics-active')) {
        toggleLyricsView();
        history.pushState({ view: 'player' }, '', '');
        event.preventDefault();
        return;
    }

    // 2. Si el reproductor completo está abierto, ciérralo y regresa a la biblioteca
    if (fullPlayer && fullPlayer.classList.contains('active')) {
        // Usamos la función interna de cierre sin alterar el elemento <audio>
        fullPlayer.classList.remove('active');
        history.pushState({ view: 'library' }, '', '');
        event.preventDefault();
        return;
    }
});