# AccessMap Ithaca

AccessMap Ithaca is a full-stack web application for crowdsourcing sidewalk accessibility data in Ithaca, NY. Users can draw paths on an interactive map, label accessibility status, and attach optional photos and notes. Contributions are stored in Firebase Firestore and synchronized in real time using snapshot listeners.

### Technical Overview

- **Frontend:** React, Vite
- **Mapping:** Leaflet, OpenStreetMap tiles
- **Backend:** Firebase (Firestore + Google OAuth)
- **UI:** Tailwind CSS, Lucide Icons

### Key Features

- Interactive sidewalk path drawing on a Leaflet map
- Real-time Firestore synchronization via `onSnapshot`
- Google-authenticated submissions with ownership-based deletion
- Client-side image compression for uploads
- Category-based filtering with color-coded map rendering
