import Head from "next/head";
import React, { useEffect, useRef, useState } from "react";
import styles from "../styles/Home.module.css";
import { RtmChannel } from "agora-rtm-sdk";
import {
  ICameraVideoTrack,
  IRemoteVideoTrack,
  IAgoraRTCClient,
  IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import { Analytics } from "@vercel/analytics/react";
import { isWithinRadius } from "../utils/geofence";

const HomePage: React.FC = () => {
  const [accessGranted, setAccessGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;

          // VIT Campus Coordinates
          const vitLatitude = 12.969200;
          const vitLongitude = 79.155900;
          const radiusInKm = 5; // 5 km radius

          // Check if the user is within the allowed radius
          const withinRadius = isWithinRadius(
            latitude,
            longitude,
            vitLatitude,
            vitLongitude,
            radiusInKm
          );

          if (withinRadius) {
            setAccessGranted(true);
          } else {
            setAccessGranted(false);
          }
        },
        (geoError) => {
          setError("Geolocation permission denied or unavailable.");
        }
      );
    } else {
      setError("Geolocation is not supported by your browser.");
    }
  }, []);

  if (accessGranted === null) {
    return <h1>Loading...</h1>;
  }

  if (error) {
    return <h1>{error}</h1>;
  }

  if (!accessGranted) {
    return <h1>Access Denied: You are not on the VIT campus.</h1>;
  }

  return <h1>Welcome to the VIT Campus!</h1>;
};
export { HomePage };

type TCreateRoomResponse = {
  room: Room;
  rtcToken: string;
  rtmToken: string;
};

type TGetRandomRoomResponse = {
  rtcToken: string;
  rtmToken: string;
  rooms: Room[];
};

type Room = {
  _id: string;
  status: string;
};

type TMessage = {
  userId: string;
  message: string | undefined;
};

function createRoom(userId: string): Promise<TCreateRoomResponse> {
  return fetch(`/api/rooms?userId=${userId}`, {
    method: "POST",
  }).then((response) => response.json());
}

function getRandomRoom(userId: string): Promise<TGetRandomRoomResponse> {
  return fetch(`/api/rooms?userId=${userId}`).then((response) =>
    response.json()
  );
}

function setRoomToWaiting(roomId: string) {
  return fetch(`/api/rooms/${roomId}`, { method: "PUT" }).then((response) =>
    response.json()
  );
}

export const VideoPlayer = ({
  videoTrack,
  style,
}: {
  videoTrack: IRemoteVideoTrack | ICameraVideoTrack;
  style: object;
}) => {
  const ref = useRef(null);

  useEffect(() => {
    const playerRef = ref.current;
    if (!videoTrack) return;
    if (!playerRef) return;

    videoTrack.play(playerRef);

    return () => {
      videoTrack.stop();
    };
  }, [videoTrack]);

  return <div ref={ref} style={style}></div>;
};

async function connectToAgoraRtc(
  roomId: string,
  userId: string,
  onVideoConnect: any,
  onWebcamStart: any,
  onAudioConnect: any,
  token: string
) {
  const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");

  const client = AgoraRTC.createClient({
    mode: "rtc",
    codec: "vp8",
  });

  await client.join(
    process.env.NEXT_PUBLIC_AGORA_APP_ID!,
    roomId,
    token,
    userId
  );

  client.on("user-published", (themUser, mediaType) => {
    client.subscribe(themUser, mediaType).then(() => {
      if (mediaType === "video") {
        onVideoConnect(themUser.videoTrack);
      }
      if (mediaType === "audio") {
        onAudioConnect(themUser.audioTrack);
        themUser.audioTrack?.play();
      }
    });
  });

  const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
  onWebcamStart(tracks[1]);
  await client.publish(tracks);

  return { tracks, client };
}

async function connectToAgoraRtm(
  roomId: string,
  userId: string,
  onMessage: (message: TMessage) => void,
  token: string
) {
  const { default: AgoraRTM } = await import("agora-rtm-sdk");
  const client = AgoraRTM.createInstance(process.env.NEXT_PUBLIC_AGORA_APP_ID!);
  await client.login({
    uid: userId,
    token,
  });
  const channel = await client.createChannel(roomId);
  await channel.join();
  channel.on("ChannelMessage", (message, userId) => {
    onMessage({
      userId,
      message: message.text,
    });
  });

  return {
    channel,
  };
}

export default function Home() {
  const [userId] = useState(parseInt(`${Math.random() * 1e6}`) + "");
  const [room, setRoom] = useState<Room | undefined>();
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [input, setInput] = useState("");
  const [themVideo, setThemVideo] = useState<IRemoteVideoTrack>();
  const [myVideo, setMyVideo] = useState<ICameraVideoTrack>();
  const [themAudio, setThemAudio] = useState<IRemoteAudioTrack>();
  const channelRef = useRef<RtmChannel>();
  const rtcClientRef = useRef<IAgoraRTCClient>();

  function handleNextClick() {
    connectToARoom();
  }

  function handleStartChattingClicked() {
    connectToARoom();
  }

  async function handleSubmitMessage(e: React.FormEvent) {
    e.preventDefault();
    await channelRef.current?.sendMessage({
      text: input,
    });
    setMessages((cur) => [
      ...cur,
      {
        userId,
        message: input,
      },
    ]);
    setInput("");
  }

  async function connectToARoom() {
    setThemAudio(undefined);
    setThemVideo(undefined);
    setMyVideo(undefined);
    setMessages([]);

    if (channelRef.current) {
      await channelRef.current.leave();
    }

    if (rtcClientRef.current) {
      rtcClientRef.current.leave();
    }

    const { rooms, rtcToken, rtmToken } = await getRandomRoom(userId);

    if (room) {
      setRoomToWaiting(room._id);
    }

    if (rooms.length > 0) {
      setRoom(rooms[0]);
      const { channel } = await connectToAgoraRtm(
        rooms[0]._id,
        userId,
        (message: TMessage) => setMessages((cur) => [...cur, message]),
        rtmToken
      );
      channelRef.current = channel;

      const { tracks, client } = await connectToAgoraRtc(
        rooms[0]._id,
        userId,
        (themVideo: IRemoteVideoTrack) => setThemVideo(themVideo),
        (myVideo: ICameraVideoTrack) => setMyVideo(myVideo),
        (themAudio: IRemoteAudioTrack) => setThemAudio(themAudio),
        rtcToken
      );
      rtcClientRef.current = client;
    } else {
      const { room, rtcToken, rtmToken } = await createRoom(userId);
      setRoom(room);
      const { channel } = await connectToAgoraRtm(
        room._id,
        userId,
        (message: TMessage) => setMessages((cur) => [...cur, message]),
        rtmToken
      );
      channelRef.current = channel;

      const { tracks, client } = await connectToAgoraRtc(
        room._id,
        userId,
        (themVideo: IRemoteVideoTrack) => setThemVideo(themVideo),
        (myVideo: ICameraVideoTrack) => setMyVideo(myVideo),
        (themAudio: IRemoteAudioTrack) => setThemAudio(themAudio),
        rtcToken
      );
      rtcClientRef.current = client;
    }
  }

  function convertToYouThem(message: TMessage) {
    return message.userId === userId ? "You" : "Them";
  }

  const isChatting = room!!;

  return (
    <>
      <Head>
        <title>Wannameet</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        {isChatting ? (
          <>
            <div style={{ textAlign: 'center', marginTop: '0px' }}>
              <h1 style={{ color: '#333', fontSize: '25px', marginBottom: '15px' }}>
                Welcome to the Wannameet
              </h1></div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: "3px",
                margin: "0px auto",
                width: "fit-content", // Adjusts width to content
                border: "1px solid #ccc", // Light border for definition
                borderRadius: "8px", // Rounded corners
                backgroundColor: "#f9f9f9", // Light background color
                boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)", // Subtle shadow
                fontSize: "18px", // Font size for text
                fontWeight: "bold", // Make text stand out
                color: "#333", // Neutral text color
              }}
            >
              <span style={{ color: "#841584", marginRight: "8px" }}>Room ID:</span>
              <span>{room._id}</span>
            </div>

            <button
              onClick={handleNextClick}
              style={{
                backgroundColor: "#841584", // Button background color
                color: "white", // Text color
                padding: "10px 20px", // Padding for a better look
                border: "none", // Removes default border
                borderRadius: "5px", // Adds rounded corners
                cursor: "pointer", // Changes cursor to pointer on hover
                fontSize: "16px", // Makes the text size more readable
                transition: "background-color 0.3s ease", // Smooth hover effect
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#6c126b"}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = "#841584"}
            >
              Next
            </button>

            <div className="chat-window">
              <div className="video-panel">
                <div
                  className="video-stream"
                  style={{
                    width: "55vh",  // Set the width of the container
                    height: "35vh", // Set the height of the container (viewport height)
                    margin: "0 auto", // Center the video horizontally
                    display: "flex",  // Center the video vertically
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: "#000", // Optional: add a background color for better visibility
                  }}
                >
                  {myVideo && (
                    <VideoPlayer
                      style={{
                        width: "100%", // Make the video fill the container's width
                        height: "100%" // Make the video fill the container's height
                      }}
                      videoTrack={myVideo}
                    />
                  )}
                </div>

                <div
                  className="video-stream"
                  style={{
                    width: "55vh",  // Set the width of the container
                    height: "35vh", // Set the height of the container (viewport height)
                    margin: "0 auto", // Center the video horizontally
                    display: "flex",  // Center the video vertically
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: "#000", // Optional: add a background color for better visibility
                  }}
                >
                  {themVideo && (
                    <VideoPlayer
                      style={{
                        width: "100%", // Make the video fill the container's width
                        height: "100%" // Make the video fill the container's height
                      }}
                      videoTrack={themVideo}
                    />
                  )}
                </div>

              </div>

              <div
                className="chat-panel"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "20px",
                  margin: "20px auto",
                  width: "100%",
                  maxWidth: "500px", // Restrict panel width
                  height: "auto", // Dynamically adjusts based on content
                  borderRadius: "12px", // Rounded corners
                  backgroundColor: "#ffffff", // Card background
                  boxShadow: "0 4px 8px rgba(0, 0, 0, 0.2)", // Drop shadow for depth
                  overflow: "hidden", // Prevent content overflow
                }}
              >
                <ul
                  style={{
                    width: "100%",
                    maxHeight: "400px", // Limit height for scrolling
                    overflowY: "auto", // Enable scroll for overflow
                    padding: "10px",
                    margin: "0",
                    listStyleType: "none",
                    border: "1px solid #ccc",
                    borderRadius: "8px",
                    backgroundColor: "#f9f9f9",
                  }}
                >
                  {messages.map((message, idx) => (
                    <li
                      key={idx}
                      style={{
                        margin: "5px 0",
                        padding: "8px",
                        backgroundColor: idx % 2 === 0 ? "#e6e6e6" : "#ffffff", // Alternating row colors
                        borderRadius: "4px",
                      }}
                    >
                      {convertToYouThem(message)} - {message.message}
                    </li>
                  ))}
                </ul>

                <form
                  onSubmit={handleSubmitMessage}
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "10px",
                    margin: "20px 0 0",
                    padding: "10px",
                    width: "100%",
                    maxWidth: "400px",
                    border: "1px solid #ccc",
                    borderRadius: "8px",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                    backgroundColor: "#f9f9f9",
                  }}
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    style={{
                      flex: "1",
                      padding: "8px",
                      fontSize: "16px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      outline: "none",
                    }}
                    placeholder="Type your message here..."
                  />
                  <button
                    type="submit"
                    style={{
                      backgroundColor: "#841584",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "8px 16px",
                      fontSize: "16px",
                      cursor: "pointer",
                      transition: "background-color 0.3s ease",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#6c126b")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#841584")}
                  >
                    Submit
                  </button>
                </form>
              </div>

            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                height: "500px", // Full viewport height
                width: "900px",
                backgroundColor: "#e0f7fa", // Light background for the page
                fontFamily: "Arial, sans-serif", // Clean, modern font
              }}
            >
              <h1
                style={{
                  fontSize: "36px", // Large, eye-catching heading
                  color: "#333", // Dark text for contrast
                  margin: "10px 0", // Margin around the heading
                }}
              >
                Welcome to the Wannameet
              </h1>

              <p
                style={{
                  fontSize: "16px", // Smaller text for the subheading
                  color: "#777", // Subtle gray color for the subheading
                  marginBottom: "40px", // Add space before the button
                }}
              >
                An exclusive
              </p>
              <button
                onClick={handleStartChattingClicked}
                style={{
                  backgroundColor: '#6C4F94', // Green background
                  color: 'white', // White text
                  padding: '15px 30px', // Larger padding for a more prominent button
                  border: 'none', // No border
                  borderRadius: '8px', // Rounded corners for a soft look
                  cursor: 'pointer', // Pointer cursor on hover
                  fontSize: '18px', // Larger font size
                  transition: 'background-color 0.3s ease', // Smooth hover effect
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)', // Soft shadow for depth
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4CAF50'}
              >
                Start Chatting
              </button>
            </div>

          </>
        )}
      </main>
    </>
  );
}
