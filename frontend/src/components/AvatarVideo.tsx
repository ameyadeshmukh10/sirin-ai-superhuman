// LiveAvatar (HeyGen) stage: joins the LiveKit room the backend created and
// renders the avatar's lip-synced video. Audio rides the same stream — the
// speaker toggle mutes it here (pcmPlayer is idle in avatar mode).

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

type Props = {
  url: string;
  token: string;
  speaking: boolean;
  muted: boolean;
  name: string;
};

export default function AvatarVideo({ url, token, speaking, muted, name }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true });

    const attach = (track: RemoteTrack) => {
      if (cancelled) return;
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        setConnected(true);
      } else if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
      }
    };

    room.on(RoomEvent.TrackSubscribed, attach);
    room
      .connect(url, token)
      .then(() => {
        if (cancelled) {
          room.disconnect();
          return;
        }
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (pub.track) attach(pub.track as RemoteTrack);
          }
        }
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      room.disconnect();
    };
  }, [url, token]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted, connected]);

  return (
    <div
      className={`relative aspect-video w-[min(560px,60vw)] overflow-hidden rounded-2xl border-2 transition-colors duration-300 ${
        speaking ? "border-accent/70" : "border-line"
      }`}
    >
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
      <audio ref={audioRef} autoPlay className="hidden" />
      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel">
          <span className="text-4xl font-bold text-accent">{name.charAt(0)}</span>
          <span className="text-xs text-muted">
            {failed ? "Avatar unavailable" : "Connecting avatar…"}
          </span>
        </div>
      )}
    </div>
  );
}
