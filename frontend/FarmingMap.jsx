import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Import Leaflet.markercluster CSS and JS
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import {
  FaMapMarkerAlt, FaCloud, FaLeaf, FaExclamationTriangle,
  FaTimes, FaLocationArrow, FaDownload, FaWifi, FaDatabase,
  FaTrash, FaDrawPolygon, FaCheck, FaSatellite, FaMap,
  FaInfoCircle, FaSync,
} from 'react-icons/fa';
import offlineMapService from './services/offlineMapService';
import './FarmingMap.css';

// ── Icons ────────────────────────────────────────────────────────────────────
const mkIcon = (emoji, cls) =>
  L.divIcon({ html: `<div class="fm-icon">${emoji}</div>`, iconSize: [32, 32], className: cls });

const ICONS = {
  weather: () => mkIcon('🌤️', 'weather-marker'),
  crop:    () => mkIcon('🌾', 'crop-marker'),
  user:    () => mkIcon('📍', 'user-marker'),
  alert:   () => mkIcon('⚠️', 'alert-marker'),
  field:   () => mkIcon('🟢', 'field-marker'),
};

const TILE_URLS = {
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  street:    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};

const TILE_ATTR = {
  satellite: 'Tiles &copy; Esri',
  street:    '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function FarmingMap() {
  const mapContainer = useRef(null);
  const map          = useRef(null);
  const markersRef   = useRef({});
  const drawLayer    = useRef(null);
  const drawPoints   = useRef([]);
  const tileLayers   = useRef({});
  const syncTimeout  = useRef(null);
  
  // Marker cluster groups for better performance with thousands of markers
  const clusterGroups = useRef({
    weather: null,
    crops: null,
    alerts: null,
    fields: null
  });

  // Core state
  const [userLocation,    setUserLocation]    = useState(null);
  const [mapError,        setMapError]        = useState(null);
  const [selectedMarker,  setSelectedMarker]  = useState(null);
  const [mapStyle,        setMapStyle]        = useState('satellite');
  const [isOnline,        setIsOnline]        = useState(navigator.onLine);

  // Layer toggles
  const [showWeather, setShowWeather] = useState(true);
  const [showCrops,   setShowCrops]   = useState(true);
  const [showAlerts,  setShowAlerts]  = useState(true);
  const [showFields,  setShowFields]  = useState(true);

  // Offline / download
  const [offlineRegions,  setOfflineRegions]  = useState([]);
  const [cacheStats,      setCacheStats]      = useState(null);
  const [downloading,     setDownloading]     = useState(false);
  const [downloadProgress,setDownloadProgress]= useState(null);
  const [showOfflinePanel,setShowOfflinePanel]= useState(false);
  const [downloadError,   setDownloadError]   = useState(null);

  // Field drawing
  const [drawMode,     setDrawMode]     = useState(false);
  const [fieldName,    setFieldName]    = useState('');
  const [savedFields,  setSavedFields]  = useState([]);
  const [showFieldForm,setShowFieldForm]= useState(false);

  // GPS tracking
  const [tracking, setTracking] = useState(false);
  const watchIdRef = useRef(null);

  // ── Online/offline listener ──────────────────────────────────────────────
  useEffect(() => {
    const on  = () => { setIsOnline(true);  handleSync(); };
    const off = () => setIsOnline(false);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Load saved data on mount ─────────────────────────────────────────────
  useEffect(() => {
    loadOfflineData();
    offlineMapService.pruneExpiredTiles().catch(() => {});
  }, []);

  async function loadOfflineData() {
    const [regions, fields, stats] = await Promise.all([
      offlineMapService.getAllRegionMeta(),
      offlineMapService.getAllFields(),
      offlineMapService.getCacheStats(),
    ]);
    setOfflineRegions(regions);
    setSavedFields(fields);
    setCacheStats(stats);
  }

  // ── Map initialise ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current) return;
    if (map.current) { map.current.remove(); map.current = null; }

    try {
      const m = L.map(mapContainer.current, { 
        preferCanvas: true, 
        zoomControl: false,
        // Additional performance optimizations
        fadeAnimation: false,
        markerZoomAnimation: false
      })
        .setView([20.5937, 78.9629], 5);
      L.control.zoom({ position: 'bottomright' }).addTo(m);
      map.current = m;
      addTileLayer(m, 'satellite');
      
      // Initialize marker cluster groups
      clusterGroups.current.weather = L.markerClusterGroup({
        // Performance optimizations for cluster groups
        maxClusterRadius: 80, // pixels
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 17, // Don't cluster at high zoom levels
        chunkedLoading: true, // Load markers in chunks for better performance
        chunkInterval: 200, // Process markers in chunks every 200ms
        chunkDelay: 50, // Delay between chunks
        singleMarkerMode: false
      });
      
      clusterGroups.current.crops = L.markerClusterGroup({
        maxClusterRadius: 80,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 17,
        chunkedLoading: true,
        chunkInterval: 200,
        chunkDelay: 50,
        singleMarkerMode: false
      });
      
      clusterGroups.current.alerts = L.markerClusterGroup({
        maxClusterRadius: 100, // Larger radius for alerts to group them more
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 16,
        chunkedLoading: true,
        chunkInterval: 200,
        chunkDelay: 50,
        singleMarkerMode: false
      });
      
      // Add cluster groups to map (initially all added)
      clusterGroups.current.weather.addTo(m);
      clusterGroups.current.crops.addTo(m);
      clusterGroups.current.alerts.addTo(m);
      
    } catch (err) {
      setMapError('Failed to initialise map. Please refresh.');
    }

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      if (map.current) { 
        // Clean up cluster groups
        Object.values(clusterGroups.current).forEach(group => {
          if (group) {
            group.clearLayers();
            if (map.current.hasLayer(group)) {
              map.current.removeLayer(group);
            }
          }
        });
        map.current.remove(); 
        map.current = null; 
      }
    };
  }, []);

  // ── Tile layer helpers ───────────────────────────────────────────────────
  function addTileLayer(m, style) {
    Object.values(tileLayers.current).forEach(l => m.removeLayer(l));
    tileLayers.current = {};
    try {
      const l = L.tileLayer(TILE_URLS[style], { attribution: TILE_ATTR[style], maxZoom: 19 }).addTo(m);
      tileLayers.current[style] = l;
    } catch {}
  }

  useEffect(() => {
    if (map.current) addTileLayer(map.current, mapStyle);
  }, [mapStyle]);

  // ── GPS location ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) {
      setMapError('Geolocation not supported.');
      setUserLocation([20.5937, 78.9629]);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserLocation([lat, lng]);
        setMapError(null);
        map.current?.setView([lat, lng], 13);
      },
      () => {
        setMapError('Location access denied. Showing India overview.');
        setUserLocation([20.5937, 78.9629]);
      }
    );
  }, []);

  // ── Continuous GPS tracking ──────────────────────────────────────────────
  const toggleTracking = useCallback(() => {
    if (tracking) {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setTracking(false);
    } else {
      watchIdRef.current = navigator.geolocation.watchPosition(
        ({ coords: { latitude: lat, longitude: lng } }) => {
          setUserLocation([lat, lng]);
          map.current?.panTo([lat, lng]);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000 }
      );
      setTracking(true);
    }
  }, [tracking]);

  // ── User marker ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !userLocation) return;
    if (markersRef.current.user) map.current.removeLayer(markersRef.current.user);
    markersRef.current.user = L.marker(userLocation, { 
      icon: ICONS.user(),
      // User marker should not be clustered
      zIndexOffset: 1000 // Keep user marker on top
    })
      .addTo(map.current)
      .bindPopup(`<div class="map-popup"><strong>📍 Your Location</strong><p>Lat: ${userLocation[0].toFixed(5)}</p><p>Lng: ${userLocation[1].toFixed(5)}</p></div>`);
  }, [userLocation]);

  // ── Weather markers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !userLocation || !clusterGroups.current.weather) return;
    
    // Clear previous weather markers from cluster group
    clusterGroups.current.weather.clearLayers();
    
    if (!showWeather) return;
    
    // Generate more weather markers for testing clustering (in real app, this would come from API)
    const pts = [];
    const markerCount = 50; // Simulate many markers for clustering
    
    for (let i = 0; i < markerCount; i++) {
      const lat = userLocation[0] + (Math.random() - 0.5) * 0.1;
      const lng = userLocation[1] + (Math.random() - 0.5) * 0.1;
      const title = `Weather Station ${i + 1}`;
      const temp = 20 + Math.floor(Math.random() * 15);
      const humidity = 50 + Math.floor(Math.random() * 40);
      const conditions = ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rainy', 'Stormy'];
      const cond = conditions[Math.floor(Math.random() * conditions.length)];
      
      pts.push({ 
        lat, lng, title, temp, humidity, cond,
        id: `weather-${i}`,
        type: 'weather'
      });
    }
    
    // Add markers to cluster group
    pts.forEach(p => {
      const marker = L.marker([p.lat, p.lng], { 
        icon: ICONS.weather(),
        title: p.title
      })
        .bindPopup(`<div class="map-popup weather-popup"><strong>${p.title}</strong><p>🌡️ ${p.temp}°C</p><p>💧 ${p.humidity}%</p><p>☁️ ${p.cond}</p></div>`)
        .on('click', () => setSelectedMarker(p));
      
      clusterGroups.current.weather.addLayer(marker);
    });
    
    // Store reference to markers
    markersRef.current.weather = pts;
  }, [showWeather, userLocation]);

  // ── Crop markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !userLocation || !clusterGroups.current.crops) return;
    
    // Clear previous crop markers from cluster group
    clusterGroups.current.crops.clearLayers();
    
    if (!showCrops) return;
    
    // Generate more crop markers for testing clustering (in real app, this would come from API)
    const pts = [];
    const markerCount = 100; // Simulate many crop markers for clustering
    
    const crops = ['Paddy', 'Wheat', 'Corn', 'Soybean', 'Cotton', 'Vegetables', 'Fruits'];
    const statuses = ['Good', 'Needs Water', 'Needs Fertilizer', 'Harvest Ready', 'Disease Detected'];
    
    for (let i = 0; i < markerCount; i++) {
      const lat = userLocation[0] + (Math.random() - 0.5) * 0.2;
      const lng = userLocation[1] + (Math.random() - 0.5) * 0.2;
      const crop = crops[Math.floor(Math.random() * crops.length)];
      const title = `${crop} Field ${String.fromCharCode(65 + (i % 26))}`;
      const area = `${1 + Math.floor(Math.random() * 10)} acres`;
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      
      pts.push({ 
        lat, lng, title, crop, area, status,
        id: `crop-${i}`,
        type: 'crop'
      });
    }
    
    // Add markers to cluster group
    pts.forEach(p => {
      const marker = L.marker([p.lat, p.lng], { 
        icon: ICONS.crop(),
        title: p.title
      })
        .bindPopup(`<div class="map-popup crop-popup"><strong>${p.title}</strong><p>🌾 ${p.crop}</p><p>📍 ${p.area}</p><p>✅ ${p.status}</p></div>`)
        .on('click', () => setSelectedMarker(p));
      
      clusterGroups.current.crops.addLayer(marker);
    });
    
    // Store reference to markers
    markersRef.current.crops = pts;
  }, [showCrops, userLocation]);

  // ── Alert markers ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !userLocation || !clusterGroups.current.alerts) return;
    
    // Clear previous alert markers from cluster group
    clusterGroups.current.alerts.clearLayers();
    
    if (!showAlerts) return;
    
    // Generate more alert markers for testing clustering (in real app, this would come from API)
    const pts = [];
    const markerCount = 30; // Simulate alert markers for clustering
    
    const alertTypes = ['Heavy Rain', 'Drought Warning', 'Pest Alert', 'Flood Warning', 'Frost Alert', 'Heat Wave'];
    const severities = ['Low', 'Medium', 'High', 'Critical'];
    
    for (let i = 0; i < markerCount; i++) {
      const lat = userLocation[0] + (Math.random() - 0.5) * 0.15;
      const lng = userLocation[1] + (Math.random() - 0.5) * 0.15;
      const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
      const title = `${alertType} Alert`;
      const severity = severities[Math.floor(Math.random() * severities.length)];
      const messages = [
        'Expected in next 24 hours',
        'Immediate action required',
        'Monitor conditions closely',
        'Take preventive measures',
        'Evacuation may be necessary'
      ];
      const message = messages[Math.floor(Math.random() * messages.length)];
      
      pts.push({ 
        lat, lng, title, severity, message,
        id: `alert-${i}`,
        type: 'alert',
        alertType
      });
    }
    
    // Add markers to cluster group
    pts.forEach(p => {
      const marker = L.marker([p.lat, p.lng], { 
        icon: ICONS.alert(),
        title: p.title
      })
        .bindPopup(`<div class="map-popup alert-popup"><strong>⚠️ ${p.title}</strong><p>Severity: ${p.severity}</p><p>${p.message}</p></div>`)
        .on('click', () => setSelectedMarker(p));
      
      clusterGroups.current.alerts.addLayer(marker);
    });
    
    // Store reference to markers
    markersRef.current.alerts = pts;
  }, [showAlerts, userLocation]);

  // ── Saved field boundaries on map ────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    
    // Clear previous field polygons
    (markersRef.current.fieldPolygons || []).forEach(l => {
      if (l && map.current) {
        map.current.removeLayer(l);
      }
    });
    
    if (!showFields) return;
    
    // Create field polygons with performance optimizations
    markersRef.current.fieldPolygons = savedFields.map(f => {
      if (!f.points?.length) return null;
      
      // Optimize polygon rendering for performance
      const poly = L.polygon(f.points, { 
        color: '#4caf50', 
        fillColor: '#4caf50', 
        fillOpacity: 0.2, 
        weight: 2,
        // Performance optimizations
        smoothFactor: 1.0, // Less smoothing for better performance
        noClip: false,
        bubblingMouseEvents: false
      })
        .addTo(map.current)
        .bindPopup(`<div class="map-popup crop-popup"><strong>🟢 ${f.name}</strong><p>Points: ${f.points.length}</p><p>Saved: ${new Date(f.savedAt).toLocaleDateString()}</p></div>`);
      
      return poly;
    }).filter(Boolean);
  }, [savedFields, showFields]);

  // ── Draw mode ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    if (drawMode) {
      map.current.getContainer().style.cursor = 'crosshair';
      map.current.on('click', handleMapClick);
    } else {
      map.current.getContainer().style.cursor = '';
      map.current.off('click', handleMapClick);
      // Clear temp draw layer
      if (drawLayer.current) { map.current.removeLayer(drawLayer.current); drawLayer.current = null; }
      drawPoints.current = [];
    }
    return () => { map.current?.off('click', handleMapClick); };
  }, [drawMode]);

  function handleMapClick(e) {
    drawPoints.current.push([e.latlng.lat, e.latlng.lng]);
    if (drawLayer.current) map.current.removeLayer(drawLayer.current);
    if (drawPoints.current.length >= 2) {
      drawLayer.current = L.polygon(drawPoints.current, { color: '#ff9800', dashArray: '6,6', fillOpacity: 0.15 })
        .addTo(map.current);
    } else {
      L.circleMarker(drawPoints.current[0], { radius: 5, color: '#ff9800' }).addTo(map.current);
    }
    if (drawPoints.current.length >= 3) setShowFieldForm(true);
  }

  async function saveField() {
    if (!fieldName.trim() || drawPoints.current.length < 3) return;
    const field = { id: Date.now().toString(), name: fieldName.trim(), points: [...drawPoints.current], savedAt: Date.now() };
    await offlineMapService.saveFieldBoundary(field);
    setSavedFields(prev => [...prev, field]);
    setFieldName('');
    setDrawMode(false);
    setShowFieldForm(false);
  }

  async function removeField(id) {
    await offlineMapService.deleteField(id);
    setSavedFields(prev => prev.filter(f => f.id !== id));
  }

  // ── Offline download ─────────────────────────────────────────────────────
  async function downloadCurrentView() {
    if (!map.current || downloading) return;
    setDownloadError(null);
    setDownloading(true);
    setDownloadProgress({ downloaded: 0, total: 0, percent: 0 });

    const bounds = map.current.getBounds();
    const zoom   = map.current.getZoom();
    const zLevels = Array.from({ length: 4 }, (_, i) => Math.min(zoom + i - 1, 17)).filter(z => z >= 8);
    const region  = `region-${Date.now()}`;

    const b = {
      north: bounds.getNorth(), south: bounds.getSouth(),
      east:  bounds.getEast(),  west:  bounds.getWest(),
    };

    const estimate = offlineMapService.estimateDownloadSize(b, zLevels);
    if (estimate.tileCount > 800) {
      setDownloadError(`Too many tiles (${estimate.tileCount}). Zoom in closer before downloading.`);
      setDownloading(false);
      return;
    }

    try {
      await offlineMapService.downloadRegion({
        bounds: b, zoomLevels: zLevels, region, style: mapStyle,
        onProgress: setDownloadProgress,
      });
      await loadOfflineData();
    } catch (err) {
      setDownloadError('Download failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function deleteRegion(key) {
    await offlineMapService.deleteRegion(key);
    await loadOfflineData();
  }

  // ── Background sync ──────────────────────────────────────────────────────
  function handleSync() {
    clearTimeout(syncTimeout.current);
    syncTimeout.current = setTimeout(() => {
      loadOfflineData();
    }, 2000);
  }

  const locateMe = () => { if (userLocation && map.current) map.current.setView(userLocation, 14); };

  const fmtBytes = (b) => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="farming-map-container">

      {/* Status bar */}
      <div className={`fm-status-bar ${isOnline ? 'online' : 'offline'}`}>
        {isOnline ? <><FaWifi /> Online — live data active</> : <><FaDatabase /> Offline — cached maps active</>}
      </div>

      {/* Left panel — layers */}
      <div className="map-layers-panel">
        <h3>🗺️ Map Layers</h3>

        {/* Map style */}
        <div className="fm-style-toggle">
          <button className={mapStyle === 'satellite' ? 'active' : ''} onClick={() => setMapStyle('satellite')}><FaSatellite /> Satellite</button>
          <button className={mapStyle === 'street'    ? 'active' : ''} onClick={() => setMapStyle('street')}><FaMap /> Street</button>
        </div>

        <div className="layer-toggle"><label><input type="checkbox" checked={showWeather} onChange={e => setShowWeather(e.target.checked)} /><FaCloud /> Weather</label></div>
        <div className="layer-toggle"><label><input type="checkbox" checked={showCrops}   onChange={e => setShowCrops(e.target.checked)}   /><FaLeaf /> Crop Fields</label></div>
        <div className="layer-toggle"><label><input type="checkbox" checked={showAlerts}  onChange={e => setShowAlerts(e.target.checked)}   /><FaExclamationTriangle /> Alerts</label></div>
        <div className="layer-toggle"><label><input type="checkbox" checked={showFields}  onChange={e => setShowFields(e.target.checked)}   /><FaDrawPolygon /> My Fields</label></div>

        {/* Saved fields list */}
        {savedFields.length > 0 && (
          <div className="fm-fields-list">
            <p className="fm-section-label">Saved Fields</p>
            {savedFields.map(f => (
              <div key={f.id} className="fm-field-item">
                <span>🟢 {f.name}</span>
                <button onClick={() => removeField(f.id)} title="Delete field"><FaTrash /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top-right controls */}
      <div className="map-controls">
        <button className="map-control-btn locate-btn" onClick={locateMe} title="Locate me">
          <FaLocationArrow /> Locate Me
        </button>
        <button className={`map-control-btn track-btn ${tracking ? 'active' : ''}`} onClick={toggleTracking} title="Live GPS">
          <FaSync /> {tracking ? 'Stop GPS' : 'Live GPS'}
        </button>
        <button className={`map-control-btn draw-btn ${drawMode ? 'active' : ''}`} onClick={() => setDrawMode(!drawMode)} title="Draw field">
          <FaDrawPolygon /> {drawMode ? 'Cancel Draw' : 'Draw Field'}
        </button>
        <button className="map-control-btn offline-btn" onClick={() => setShowOfflinePanel(!showOfflinePanel)} title="Offline maps">
          <FaDownload /> Offline Maps
        </button>
      </div>

      {/* Draw instructions */}
      {drawMode && (
        <div className="fm-draw-hint">
          <FaInfoCircle /> Click on the map to mark field boundaries (min 3 points), then save.
        </div>
      )}

      {/* Field name form */}
      {showFieldForm && (
        <div className="fm-field-form">
          <h4>Save Field Boundary</h4>
          <input
            type="text" placeholder="Field name (e.g. North Paddy Field)"
            value={fieldName} onChange={e => setFieldName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveField()}
            autoFocus
          />
          <div className="fm-form-btns">
            <button className="btn-save" onClick={saveField} disabled={!fieldName.trim()}><FaCheck /> Save</button>
            <button className="btn-cancel" onClick={() => { setShowFieldForm(false); setDrawMode(false); }}><FaTimes /> Cancel</button>
          </div>
        </div>
      )}

      {/* Offline panel */}
      {showOfflinePanel && (
        <div className="fm-offline-panel">
          <div className="fm-offline-header">
            <h3><FaDatabase /> Offline Maps</h3>
            <button onClick={() => setShowOfflinePanel(false)}><FaTimes /></button>
          </div>

          {cacheStats && (
            <div className="fm-cache-stats">
              <div className="stat"><span>{cacheStats.tileCount}</span><label>Cached Tiles</label></div>
              <div className="stat"><span>{cacheStats.totalMB} MB</span><label>Storage Used</label></div>
              <div className="stat"><span>{cacheStats.regionCount}</span><label>Regions</label></div>
            </div>
          )}

          <div className="fm-download-section">
            <p className="fm-section-label">Download current map view for offline use:</p>
            {!isOnline && <p className="fm-offline-warn">⚠️ You are offline. Cannot download new maps.</p>}
            {downloadError && <p className="fm-error-msg">❌ {downloadError}</p>}

            {downloading ? (
              <div className="fm-progress">
                <div className="fm-progress-bar">
                  <div className="fm-progress-fill" style={{ width: `${downloadProgress?.percent || 0}%` }} />
                </div>
                <span>{downloadProgress?.percent || 0}% — {downloadProgress?.downloaded}/{downloadProgress?.total} tiles</span>
              </div>
            ) : (
              <button className="btn-download" onClick={downloadCurrentView} disabled={!isOnline}>
                <FaDownload /> Download Current View
              </button>
            )}
          </div>

          {/* Cached regions */}
          {offlineRegions.length > 0 && (
            <div className="fm-regions-list">
              <p className="fm-section-label">Downloaded Regions</p>
              {offlineRegions.map(r => (
                <div key={r.key} className="fm-region-item">
                  <div>
                    <strong>{r.key}</strong>
                    <span>{r.downloaded}/{r.total} tiles • {new Date(r.timestamp).toLocaleDateString()}</span>
                    <span className={`fm-region-status ${r.status}`}>{r.status}</span>
                  </div>
                  <button onClick={() => deleteRegion(r.key)} title="Delete region"><FaTrash /></button>
                </div>
              ))}
            </div>
          )}

          <button className="btn-sync" onClick={loadOfflineData}><FaSync /> Refresh Stats</button>
        </div>
      )}

      {/* Error banner */}
      {mapError && <div className="map-error"><FaInfoCircle /> {mapError}</div>}

      {/* The map */}
      <div ref={mapContainer} className="map-container" />

      {/* Selected marker details */}
      {selectedMarker && (
        <div className="marker-details-panel">
          <button className="close-details-btn" onClick={() => setSelectedMarker(null)}><FaTimes /></button>
          <h3>{selectedMarker.title || selectedMarker.id}</h3>
          <div className="marker-details">
            {Object.entries(selectedMarker).filter(([k]) => !['id','lat','lng','title'].includes(k)).map(([k, v]) => (
              <div key={k} className="detail-item">
                <strong>{k}:</strong> <span>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}