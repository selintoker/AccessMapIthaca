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

<img width="1440" height="778" alt="Screenshot 2026-01-02 at 1 03 17 AM" src="https://github.com/user-attachments/assets/08ed8ca2-e834-4eb8-b612-da1749fc0e96" />

<img width="1440" height="778" alt="Screenshot 2025-12-29 at 4 54 57 PM" src="https://github.com/user-attachments/assets/8a4bbef8-efe8-4b5f-84ea-2acc7d51391e" />

