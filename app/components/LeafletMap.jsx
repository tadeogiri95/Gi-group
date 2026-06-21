"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function LeafletMap({ lat, lng, zoom = 14, radio = 150, onMapClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: false }).setView([lat, lng], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([lat, lng], { icon: ICON }).addTo(map);
    const circle = L.circle([lat, lng], { radius: radio, color: "#00D1B2", fillColor: "#00D1B2", fillOpacity: 0.15, weight: 2 }).addTo(map);

    map.on("click", (e) => { onMapClick?.(e.latlng.lat, e.latlng.lng); });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    setTimeout(() => map.invalidateSize(), 200);

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    markerRef.current?.setLatLng([lat, lng]);
    circleRef.current?.setLatLng([lat, lng]);
    circleRef.current?.setRadius(radio);
    mapRef.current.setView([lat, lng], mapRef.current.getZoom());
  }, [lat, lng, radio]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
