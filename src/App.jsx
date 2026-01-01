import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {

  Plus,
  Check,
  X,
  AlertTriangle,
  Accessibility,
  Ban,
  Layers,
  Loader2,
  Camera,
  Trash2,
} from 'lucide-react';
import { db, auth } from './firebase.js'
import { collection, addDoc, onSnapshot, serverTimestamp, deleteDoc, doc, getDoc } from 'firebase/firestore'
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'

const MAP_CENTER = [42.4472, -76.4850];
const ZOOM_LEVEL = 15;

const CATEGORIES = {
  ACCESSIBLE: {
    id: 'accessible',
    label: 'Accessible',
    color: '#22c55e',
    icon: <Accessibility className="w-4 h-4" />,
    desc: 'Wheelchair friendly, good curb cuts, even pavement.'
  },
  PARTIAL: {
    id: 'partial',
    label: 'Partially Accessible',
    color: '#eab308',
    icon: <AlertTriangle className="w-4 h-4" />,
    desc: 'Minor bumps, steep grades, or poor curb cuts.'
  },
  NOT_ACCESSIBLE: {
    id: 'not_accessible',
    label: 'Not Accessible',
    color: '#ef4444',
    icon: <Ban className="w-4 h-4" />,
    desc: 'Stairs, construction, or major obstructions.'
  }
};

export default function AccessMap() {
  // --- Local State ---
  const [segments, setSegments] = useState([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Auth state
  const [user, setUser] = useState(null)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      console.log('Auth state changed:', u ? u.uid : null)
      setUser(u)
    })
    return unsub
  }, [])

  // Firestore sync: subscribe to `segments` collection and keep local state in sync
  useEffect(() => {
    try {
      const col = collection(db, 'segments')
      const unsub = onSnapshot(col, (snapshot) => {
        const items = snapshot.docs.map(d => {
          const data = d.data()
          const rawPath = data.path || []
          const path = rawPath.map(pt => {
            if (Array.isArray(pt)) return pt
            if (pt && typeof pt.lat === 'number' && typeof pt.lng === 'number') return [pt.lat, pt.lng]
            return null
          }).filter(Boolean)

          const createdAt = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : data.createdAt
          return { ...data, path, createdAt, id: d.id }
        })
        setSegments(items)
      }, (err) => {
        console.error('Firestore listener error', err)
      })
      return () => unsub()
    } catch (err) {
      console.error('Failed to subscribe to Firestore', err)
    }
  }, [])

  // Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState([]);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);

  // Deletion State
  const [segmentToDelete, setSegmentToDelete] = useState(null);

  // Form State
  const [selectedCategory, setSelectedCategory] = useState('accessible');
  const [note, setNote] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [filters, setFilters] = useState({
    accessible: true,
    partial: true,
    not_accessible: true
  });

  // Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const segmentsLayerRef = useRef(null);
  const drawingLayerRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastPointRef = useRef(null);

  // --- Actions ---

  // Global bridge for popup clicks
  useEffect(() => {
    window.accessMapDeleteSegment = (id) => {
      setSegmentToDelete(id);
    };
    return () => {
      delete window.accessMapDeleteSegment;
    };
  }, []);

  const handleConfirmDelete = () => {
    if (!segmentToDelete) return;
    const seg = segments.find(s => s.id === segmentToDelete)
    console.log('Attempting delete:', { docId: segmentToDelete, currentUid: user?.uid, ownerUid: seg?.author_uid, seg })
    if (seg && seg.author_uid && (!user || user.uid !== seg.author_uid)) {
      alert('You are not the owner of this contribution and cannot delete it.')
      setSegmentToDelete(null)
      return
    }

    // Remove from Firestore (if present) and local state
    (async () => {
      try {
        const ref = doc(db, 'segments', segmentToDelete)
        const snap = await getDoc(ref)
        console.log('Pre-delete doc snapshot:', { exists: snap.exists(), data: snap.exists() ? snap.data() : null })
        if (!snap.exists()) {
          alert('Contribution not found in cloud - it may have already been deleted.')
          setSegmentToDelete(null)
          return
        }
        await deleteDoc(ref)
        console.log('Delete successful for', segmentToDelete)
        setSegmentToDelete(null);
      } catch (e) {
        console.error('Firestore delete failed', e)
        const code = e.code || 'unknown'
        const message = e.message || String(e)
        alert(`Failed to delete contribution (${code}): ${message}`)
        setSegmentToDelete(null);
      }
    })()
  };

  // Authentication helpers
  const signIn = async () => {
    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
    } catch (e) {
      console.error('Sign-in failed', e)
      alert('Sign-in failed. Check console for details.')
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (e) {
      console.error('Sign-out failed', e)
    }
  }

  // --- Leaflet Initialization ---
  useEffect(() => {
    if (mapInstanceRef.current || !mapContainerRef.current) return;

    const ITHACA_BOUNDS = [
      [42.35, -76.65],
      [42.55, -76.30]
    ];

    const map = L.map(mapContainerRef.current, {
      maxBounds: ITHACA_BOUNDS,
      maxBoundsViscosity: 1.0,
      minZoom: 13
    }).setView(MAP_CENTER, ZOOM_LEVEL);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    segmentsLayerRef.current = L.layerGroup().addTo(map);
    drawingLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    // Force a resize to ensure tiles load
    setTimeout(() => {
      map.invalidateSize();
      setMapLoaded(true);
    }, 100);

    // Robust Click Handler
    map.on('click', (e) => {
      handleMapClickLogic(e.latlng);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []); // Run once on mount

  // --- Map Interaction Logic ---

  // We use a ref for current state inside the event listener to avoid stale closures
  const isDrawingRef = useRef(isDrawing);

  useEffect(() => {
    isDrawingRef.current = isDrawing;

    // Reset last point when drawing stops
    if (!isDrawing) {
      lastPointRef.current = null;
      if (drawingLayerRef.current) drawingLayerRef.current.clearLayers();
    }
  }, [isDrawing]);

  const handleMapClickLogic = async (latlng) => {
    if (!isDrawingRef.current) return;

    const { lat, lng } = latlng;
    const newPoint = [lat, lng];
    // If we have a previous point, append the clicked point (straight line)
    if (lastPointRef.current) {
      setCurrentPath(prev => [...prev, newPoint]);
      lastPointRef.current = newPoint;
    } else {
      // First point
      setCurrentPath([newPoint]);
      lastPointRef.current = newPoint;
    }
  };

  // Update Cursor
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const container = mapInstanceRef.current.getContainer();
    container.style.cursor = isDrawing ? 'crosshair' : 'grab';
  }, [isDrawing]);

  // Render Drawing Path
  useEffect(() => {
    if (!mapInstanceRef.current || !drawingLayerRef.current) return;

    drawingLayerRef.current.clearLayers();

    if (currentPath.length > 0) {
      // Draw the line
      L.polyline(currentPath, {
        color: '#3b82f6',
        dashArray: '10, 10',
        weight: 4,
        opacity: 0.7
      }).addTo(drawingLayerRef.current);

      // Draw Start/End dots
      L.circleMarker(currentPath[0], { radius: 5, color: '#3b82f6', fillOpacity: 1, fillColor: '#fff' }).addTo(drawingLayerRef.current);
      if (currentPath.length > 1) {
        L.circleMarker(currentPath[currentPath.length - 1], { radius: 5, color: '#3b82f6', fillOpacity: 1, fillColor: '#fff' }).addTo(drawingLayerRef.current);
      }
    }
  }, [currentPath]);

  // Render Existing Segments
  useEffect(() => {
    if (!mapInstanceRef.current || !segmentsLayerRef.current) return;

    segmentsLayerRef.current.clearLayers();

    segments.forEach(seg => {
      if (!filters[seg.category] || !seg.path || seg.path.length === 0) return;

      const config = Object.values(CATEGORIES).find(c => c.id === seg.category) || {};
      const color = config.color || '#999';

      const polyline = L.polyline(seg.path, {
        color: color,
        weight: 6,
        opacity: 0.8
      });

      const popupContent = document.createElement('div');
      const imageHtml = seg.image
        ? `<div style="width:100%; height:140px; background-image:url(${seg.image}); background-size:cover; background-position:center; border-radius: 8px 8px 0 0;"></div>`
        : '';

      const htmlString = `
        <div class="font-sans min-w-[240px] overflow-hidden">
          ${imageHtml}
          <div class="p-4">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full shadow-sm shrink-0" style="background:${color}"></span>
              <span class="font-bold text-slate-800 leading-tight">${config.label || 'Unknown Category'}</span>
            </div>
            
            ${seg.note ? `
              <div class="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 leading-relaxed">
                "${seg.note}"
              </div>
            ` : ''}
            
            <div class="flex justify-end items-center pt-3 border-t border-slate-100 mt-2">
              <button 
                onclick="window.accessMapDeleteSegment('${seg.id}')"
                class="group flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-md transition-all cursor-pointer"
                title="Delete this path"
              >
                <svg style="width:14px;height:14px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                Delete
              </button>
            </div>
          </div>
        </div>
      `;

      popupContent.innerHTML = htmlString;
      polyline.bindPopup(popupContent, { className: 'custom-popup-clean', minWidth: 240, maxWidth: 300 });
      polyline.addTo(segmentsLayerRef.current);
    });
  }, [segments, filters]);

  // --- Action Handlers ---

  const startDrawing = () => {
    setIsDrawing(true);
    setCurrentPath([]);
    lastPointRef.current = null;
    setShowSubmissionForm(false);
  };

  const cancelDrawing = () => {
    setIsDrawing(false);
    setCurrentPath([]);
    lastPointRef.current = null;
    setShowSubmissionForm(false);
    setSelectedImage(null);
    setNote('');
  };

  const finishDrawing = () => {
    if (currentPath.length < 2) {
      alert("Please draw at least 2 points");
      return;
    }
    setIsDrawing(false);
    setShowSubmissionForm(true);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large (Max 5MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 600;
        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        setSelectedImage(dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const submitSegment = async () => {
    if (!user) {
      alert('Please sign in to save contributions.')
      return
    }
    const newSegment = {
      id: Date.now().toString(),
      path: [...currentPath], // Create a copy
      category: selectedCategory,
      note: note,
      image: selectedImage,
      createdAt: new Date(),
      author_uid: user.uid
    };

    setSegments(prev => [...prev, newSegment]);

    // Write to Firestore (uses server timestamp for consistent ordering)
    try {
      const firestorePayload = {
        ...newSegment,
        path: newSegment.path.map(p => ({ lat: p[0], lng: p[1] })),
        createdAt: serverTimestamp(),
      }
      await addDoc(collection(db, 'segments'), firestorePayload)
    } catch (err) {
      console.error('Failed to write segment to Firestore', err)
      alert('Failed to save contribution to cloud. It is saved locally in this browser session. Check the console for details.')
    }

    setShowSubmissionForm(false);
    setCurrentPath([]);
    setNote('');
    setSelectedImage(null);
    setSelectedCategory('accessible');
    lastPointRef.current = null;
  };

  const toggleFilter = (key) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden relative">

      {/* Header */}
      <header className="bg-white shadow-sm z-20 px-4 py-3 flex items-center justify-between shrink-0 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="bg-[#B31B1B] w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm">
            <span className="font-serif font-bold text-2xl leading-none pt-1">C</span>
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-900">AccessMap Ithaca</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#B31B1B]"></span>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cornell University</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isDrawing && !showSubmissionForm && (
            <button
              onClick={startDrawing}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full text-sm font-medium shadow-sm transition-all active:scale-95"
            >
              <Plus size={16} />
              Add Path
            </button>
          )}
          {/* Auth buttons */}
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 hidden sm:inline">{user.displayName || user.email}</span>
              <button onClick={handleSignOut} className="px-3 py-2 rounded-full text-sm bg-slate-100 hover:bg-slate-200">Sign out</button>
            </div>
          ) : (
            <button onClick={signIn} className="px-3 py-2 rounded-full text-sm bg-white border border-slate-200 hover:bg-slate-50">Sign in</button>
          )}
          {isDrawing && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4">

              <span className="text-xs font-medium text-slate-500 mx-2 hidden sm:inline w-24 text-center">
                Click to draw
              </span>

              <button
                onClick={finishDrawing}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-full text-sm font-medium shadow-sm"
              >
                <Check size={16} />
                Finish
              </button>
              <button
                onClick={cancelDrawing}
                className="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-4 py-2 rounded-full text-sm font-medium shadow-sm"
              >
                <X size={16} />
                Cancel
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Map Container */}
      <div className="flex-1 relative isolate bg-slate-200">

        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-slate-50">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="animate-spin" size={32} />
              <p className="text-sm font-medium">Loading Map...</p>
            </div>
          </div>
        )}

        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Legend / Filters Panel */}
        <div className="absolute top-2 left-14 z-[500] bg-white/95 backdrop-blur shadow-lg rounded-xl p-4 w-64 border border-slate-200 max-h-[calc(100vh-120px)] overflow-y-auto">
          <div className="flex items-center gap-2 mb-3 text-slate-800 font-semibold text-sm">
            <Layers size={16} />
            <span>Map Layers</span>
          </div>
          <div className="space-y-2">
            {Object.values(CATEGORIES).map((cat) => (
              <label key={cat.id} className="flex items-start gap-3 cursor-pointer group p-1 rounded hover:bg-slate-50 transition-colors">
                <div className="relative flex items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={filters[cat.id]}
                    onChange={() => toggleFilter(cat.id)}
                    className="peer h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }}></span>
                    {cat.label}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{cat.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* DELETE CONFIRMATION MODAL */}
        {segmentToDelete && (
          <div className="absolute inset-0 z-[1200] bg-black/20 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 text-center">
                <div className="bg-red-100 text-red-600 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={24} />
                </div>
                <h3 className="font-semibold text-lg text-slate-800 mb-2">Delete this path?</h3>
                <p className="text-sm text-slate-500">This action cannot be undone.</p>
              </div>
              <div className="bg-slate-50 px-6 py-4 flex gap-3 justify-center border-t border-slate-100">
                <button
                  onClick={() => setSegmentToDelete(null)}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 shadow-sm transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Submission Modal */}
        {showSubmissionForm && (
          <div className="absolute inset-0 z-[1000] bg-black/20 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                <h3 className="font-semibold text-slate-800">Details for this Segment</h3>
                <button onClick={cancelDrawing} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Categories */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-3">Accessibility Status</label>
                  <div className="grid grid-cols-1 gap-3">
                    {Object.values(CATEGORIES).map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`
                          flex items-center gap-3 p-3 rounded-lg border text-left transition-all
                          ${selectedCategory === cat.id
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}
                        `}
                      >
                        <div
                          className={`p-2 rounded-full ${selectedCategory === cat.id ? 'bg-white shadow-sm' : 'bg-slate-100'}`}
                          style={{ color: cat.color }}
                        >
                          {cat.icon}
                        </div>
                        <div>
                          <div className="font-medium text-sm text-slate-900">{cat.label}</div>
                          <div className="text-xs text-slate-500">{cat.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Image Upload */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Photo <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>

                  {!selectedImage ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center text-slate-500 hover:border-blue-400 hover:bg-slate-50 transition-all group"
                    >
                      <div className="bg-slate-100 p-3 rounded-full mb-2 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                        <Camera size={24} />
                      </div>
                      <span className="text-sm font-medium">Tap to upload photo</span>
                      <span className="text-xs text-slate-400 mt-1">Max 5MB • JPG/PNG</span>
                    </button>
                  ) : (
                    <div className="relative rounded-lg overflow-hidden border border-slate-200 group">
                      <img src={selectedImage} alt="Preview" className="w-full h-48 object-cover bg-slate-100" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => setSelectedImage(null)}
                          className="bg-white/90 hover:bg-red-50 text-red-600 p-2 rounded-full shadow-sm transition-transform active:scale-95"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  )}
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleImageUpload}
                  />
                </div>

                {/* Note */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Notes <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g., No curb cut on NW corner, uneven bricks..."
                    className="w-full min-h-[80px] px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
              </div>

              <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0">
                <button
                  onClick={cancelDrawing}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={submitSegment}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-2"
                >
                  <Check size={16} />
                  Save Contribution
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}