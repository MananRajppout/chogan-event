import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import OnAirIndicator from '@/components/OnAirIndicator';
import AudioLevelMeter from '@/components/AudioLevelMeter';
import ListenerCountBadge from '@/components/ListenerCountBadge';
import { Mic, MicOff, ArrowLeft, RefreshCcw, Monitor, Radio, BarChart3, Settings, Wifi, Clock, Users, Signal, Activity, Globe, Headphones, AlertCircle, CheckCircle, Play, Pause, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getBroadcastInfoRequest } from '@/http/agoraHttp';
import { generateToken } from '@/utils/generateToken';
import Pusher from 'pusher-js';
import { pushMessage } from '@/services/PusherService';
import Dialog from './Dialog';
import { useChannel } from '@/context/ChannelContext';
import { useParams } from 'next/navigation';
import { flagsMapping, languages, twoWayLanguages, otherLanguageChannel } from '@/constants/flagsMapping';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Async Agora SDK loader
const loadAgoraSDK = async () => {
  if (typeof window === 'undefined') return null;

  try {
    const AgoraRTC = await import('agora-rtc-sdk-ng');
    return AgoraRTC.default;
  } catch (error) {
    console.error('Failed to load Agora SDK:', error);
    throw error;
  }
};

const Broadcast = () => {
  const params = useParams();
  const { language } = params;
  // Loading state for async components
  const [isSDKLoading, setIsSDKLoading] = useState(true);
  const [sdkError, setSDKError] = useState(null);
  const [AgoraRTC, setAgoraRTC] = useState(null);
  const [broadcasterCount, setBroadcasterCount] = useState(0);
  const [openRequestToHandoverPopup, setOpenRequestToHandoverPopup] = useState(false);
  const [waitingForResponseToHandoverRquestPopup, setWaitingForResponseToHandoverRquestPopup] = useState(false);
  const [handoverRequestResponse, setHandoverRequestResponse] = useState(null);
  const [loading, setLoading] = useState(false);

  // Basic state
  const [isLive, setIsLive] = useState(false);
  const [isMicConnected, setIsMicConnected] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [streamDuration, setStreamDuration] = useState(0);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [client, setClient] = useState(null);
  const [clientAsListener, setClientAsListener] = useState(null);

  const [remoteAudioTrack, setRemoteAudioTrack] = useState(null);
  const [isPartnerAudioPlaying, setIsPartnerAudioPlaying] = useState(false);
  // Enhanced monitoring state
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [networkQuality, setNetworkQuality] = useState('good');
  const [sessionId, setSessionId] = useState(null);
  const [connectionError, setConnectionError] = useState(null);

  // Refs for cleanup
  const isComponentMountedRef = useRef(true);
  const reconnectTimeoutRef = useRef(null);
  const streamStartTimeRef = useRef(null);
  const isLiveRef = useRef(false);
  const maxReconnectAttempts = 8;
  const { channelName, setLanguage, getChannelName } = useChannel();
  const [otherChannels, setOtherChannels] = useState({});
  const otherChannelsPlayingRef = useRef({});
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const [selectedOtherChannel, setSelectedOtherChannel] = useState(null);
  const channelNameRef = useRef(channelName);

  useEffect(() => {
    channelNameRef.current = channelName;
  }, [channelName]);

  useEffect(() => {
    setLanguage(language);
  }, [language]);

  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  // Generate persistent session ID for this broadcast
  useEffect(() => {
    const id = `broadcast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(id);
  }, []);

  // Load Agora SDK asynchronously
  useEffect(() => {
    let isMounted = true;

    const initializeSDK = async () => {
      try {
        setIsSDKLoading(true);
        setConnectionError(null);
        const sdk = await loadAgoraSDK();

        if (isMounted) {
          setAgoraRTC(sdk);
          setIsSDKLoading(false);
        }
      } catch (error) {
        if (isMounted) {
          setSDKError(error.message);
          setConnectionError('Failed to load broadcasting components');
          setIsSDKLoading(false);
          toast.error('Failed to load broadcasting components. Please refresh the page.');
        }
      }
    };

    initializeSDK();

    return () => {
      isMounted = false;
    };
  }, []);

  // Enhanced reconnection function with session persistence
  const attemptReconnection = useCallback(async () => {
    if (!client || !isComponentMountedRef.current || reconnectAttempts >= maxReconnectAttempts) return;

    setIsReconnecting(true);
    setReconnectAttempts(prev => prev + 1);
    setConnectionError(null);

    const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts), 10000); // Progressive backoff

    reconnectTimeoutRef.current = setTimeout(async () => {
      if (!isComponentMountedRef.current) return;

      try {
        const APP_ID = process.env.NEXT_PUBLIC_AGORA_APPID;
        const CHANNEL_NAME = channelName;
        const { token, uid } = await generateToken("PUBLISHER", channelName);

        if (!APP_ID || !CHANNEL_NAME) {
          throw new Error(`Missing broadcast configuration`);
        }

        // Try to rejoin and republish with same session context
        await client.leave().catch(() => { }); // Ignore errors
        await client.setClientRole('host');
        await client.join(APP_ID, CHANNEL_NAME, toast, uid);
        console.info(token, uid)
        if (localAudioTrack) {
          await client.publish(localAudioTrack);
        }

        setConnectionStatus('connected');
        setIsReconnecting(false);
        setReconnectAttempts(0);
        setConnectionError(null);

        toast.success('Broadcast reconnected successfully! Listeners will reconnect automatically.', {
          id: 'reconnected',
          duration: 4000
        });

      } catch (error) {
        console.error('Reconnection failed:', error);
        setConnectionError(`Reconnection failed: ${error.message}`);

        if (reconnectAttempts < maxReconnectAttempts - 1) {
          attemptReconnection(); // Try again
        } else {
          setIsReconnecting(false);
          setConnectionStatus('error');
          setConnectionError('Max reconnection attempts reached');
          toast.error('Broadcast connection failed. Please restart the broadcast.', {
            id: 'reconnect-failed',
            duration: 8000
          });
        }
      }
    }, delay);
  }, [client, localAudioTrack, reconnectAttempts, maxReconnectAttempts]);

  // Handle connection loss with enhanced detection
  const handleConnectionLoss = useCallback(() => {
    if (!isComponentMountedRef.current || isReconnecting) return;

    console.log('Broadcast connection lost - attempting reconnection');
    setConnectionStatus('disconnected');
    setConnectionError('Connection lost');

    toast.warning('Broadcast connection lost. Reconnecting automatically...', {
      id: 'connection-lost',
      duration: 5000
    });

    // Start reconnection if still live
    if (isLive && reconnectAttempts < maxReconnectAttempts) {
      attemptReconnection();
    }
  }, [isLive, isReconnecting, reconnectAttempts, attemptReconnection, maxReconnectAttempts]);

  // Initialize Agora client (only after SDK is loaded)
  useEffect(() => {
    if (!AgoraRTC || isSDKLoading) return;

    const agoraClient = AgoraRTC.createClient({
      mode: 'live',
      codec: 'vp8',
      role: 'host'
    });
    setClient(agoraClient);


    console.log(agoraClient.sendStreamMessage, "agoraClient");

    // Enhanced event listeners
    agoraClient.on('user-joined', (user) => {
      console.log('User joined:', user.uid);
    });

    agoraClient.on('user-left', (user) => {
      console.log('User left:', user.uid);
    });

    // Monitor connection state changes with better handling
    agoraClient.on('connection-state-changed', (curState, revState, reason) => {
      console.log('Connection state changed:', curState, 'from:', revState, 'reason:', reason);

      if (curState === 'CONNECTED') {
        setConnectionStatus('connected');
        setConnectionError(null);
        setNetworkQuality('good'); // Reset network quality on reconnect
      } else if (curState === 'DISCONNECTED' && isLive && connectionStatus === 'connected') {
        //handleConnectionLoss();
        handleStopStream();
        window.alert("Connection lost, broadcast stopped, Please restart the broadcast");
      } else if (curState === 'RECONNECTING') {
        setConnectionStatus('reconnecting');
        toast.info('Connection unstable, attempting to stabilize...', {
          id: 'reconnecting',
          duration: 3000
        });
      } else if (curState === 'FAILED') {
        setConnectionError(`Connection failed: ${reason}`);
        setConnectionStatus('error');
      }
    });

    // Handle exceptions with better categorization
    agoraClient.on('exception', (evt) => {
      console.error('Agora exception:', evt);
      setConnectionError(`Broadcast error: ${evt.code} - ${evt.msg || 'Unknown error'}`);

      if (evt.code === 'NETWORK_ERROR' && isLive && connectionStatus === 'connected') {
        setNetworkQuality('poor');
        //handleConnectionLoss();
      } else if (evt.code === 'MEDIA_ERROR') {
        toast.error('Microphone error detected. Please check your audio device.', {
          id: 'media-error',
          duration: 6000
        });
        setIsMicConnected(false);
      }
    });

    // Enhanced network quality monitoring
    agoraClient.on('network-quality', (stats) => {
      if (stats.uplinkNetworkQuality) {
        if (stats.uplinkNetworkQuality >= 4) {
          setNetworkQuality('poor');
          toast.warning('Poor network quality detected. Consider checking your connection.', {
            id: 'network-warning',
            duration: 4000
          });
        } else if (stats.uplinkNetworkQuality >= 3) {
          setNetworkQuality('fair');
        } else {
          setNetworkQuality('good');
        }
      }
    });


    agoraClient.on('user-published', async (user, mediaType) => {
      console.log("user publish")
      if (mediaType === 'audio') {
        await agoraClient.subscribe(user, mediaType);
        const audioTrack = user.audioTrack;
        setRemoteAudioTrack(audioTrack);
      }
    });

    agoraClient.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'audio') {
        setRemoteAudioTrack(null);
      }
    });

    return () => {
      isComponentMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      agoraClient.removeAllListeners();
    };
  }, [AgoraRTC, isSDKLoading]);


  // subscribe to other channels
  useEffect(() => {
    if (!AgoraRTC || isSDKLoading) return;
    console.log("loaderrrrrrr 1")
    const clients = [];
    otherLanguageChannel.filter((lang) => lang.value !== language).forEach((language) => {
      const agoraClient = AgoraRTC.createClient({
        mode: 'live',
        codec: 'vp8',
        role: 'audience'
      });

      clients.push(agoraClient);

      // Enhanced event handlers
      agoraClient.on('user-published', async (user, mediaType) => {
        console.log("user-published");
        if (mediaType === 'audio' && isComponentMountedRef.current && (channelNameRef.current !== getChannelName(language.value) ||
          !isLiveRef.current)) {
          console.log("user-published 1", language.value, channelNameRef.current);
          try {
            await agoraClient.subscribe(user, mediaType);
            const audioTrack = user.audioTrack;
            const isPlaying = otherChannelsPlayingRef.current[language.value];
            if (isPlaying) {
              audioTrack.setVolume(100);
              await audioTrack.play();
            }
            setOtherChannels(prev => ({ ...prev, [language.value]: { ...prev[language.value], audioTrack, isLive: true, isPlaying: !!isPlaying } }));

            toast.success(`${language.name} broadcast is live`, {
              id: 'broadcast-live',
              duration: 4000
            });
          } catch (error) {
            console.error('Error subscribing to audio:', error);
          }
        }
      });

      agoraClient.on('user-unpublished', (user, mediaType) => {
        if (mediaType === 'audio' && isComponentMountedRef.current) {
          setOtherChannels(prev => ({ ...prev, [language.value]: { ...prev[language.value], audioTrack: null, isLive: false, isPlaying: false } }));
          setSelectedOtherChannel(null);
          toast.error(`${language.name} broadcast is offline`, {
            id: 'broadcast-offline',
            duration: 4000
          });
        }
      });

      // Enhanced channel joining with timeout
      const joinChannel = async () => {

        try {
          const APP_ID = process.env.NEXT_PUBLIC_AGORA_APPID;
          const CHANNEL_NAME = getChannelName(language.value);
          const { token, uid } = await generateToken("SUBSCRIBER", CHANNEL_NAME);

          if (!APP_ID || !CHANNEL_NAME) {
            throw new Error(`Missing required Agora configuration`);
          }

          const joinPromise = (async () => {
            await agoraClient.setClientRole('audience');
            await agoraClient.join(APP_ID, CHANNEL_NAME, token, uid);
          })();


          await Promise.race([joinPromise]);
        } catch (error) {
          console.error("Error joining channel:", error);
        }
      };

      joinChannel();

    })

    return () => {
      clients.forEach(client => {
        client.removeAllListeners();
      });
    };
  }, [AgoraRTC, isSDKLoading]);


  // Initialize Agora client as listener
  useEffect(() => {
    if (!AgoraRTC || isSDKLoading) return;
    console.log("loaderrrrrrr 2")

    const agoraClient = AgoraRTC.createClient({
      mode: 'live',
      codec: 'vp8',
      role: 'audience'
    });
    setClientAsListener(agoraClient);

    // Enhanced event handlers
    agoraClient.on('user-published', async (user, mediaType) => {
      console.log("user-published");
      if (mediaType === 'audio' && isComponentMountedRef.current) {
        try {
          await agoraClient.subscribe(user, mediaType);
          const audioTrack = user.audioTrack;
          setRemoteAudioTrack(audioTrack);
        } catch (error) {
          console.error('Error subscribing to audio:', error);
        }
      }
    });

    agoraClient.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'audio' && isComponentMountedRef.current) {
        setIsPartnerAudioPlaying(false);
        setRemoteAudioTrack(null);
      }
    });

    // Enhanced channel joining with timeout
    const joinChannel = async () => {

      try {
        const APP_ID = process.env.NEXT_PUBLIC_AGORA_APPID;
        const CHANNEL_NAME = getChannelName(language);
        const { token, uid } = await generateToken("SUBSCRIBER", CHANNEL_NAME);

        if (!APP_ID || !CHANNEL_NAME) {
          throw new Error(`Missing required Agora configuration`);
        }

        const joinPromise = (async () => {
          await agoraClient.setClientRole('audience');
          await agoraClient.join(APP_ID, CHANNEL_NAME, token, uid);
        })();


        await Promise.race([joinPromise]);
      } catch (error) {
        console.error("Error joining channel:", error);
      }
    };


    joinChannel();

    return () => {
      console.log("loaderrrrrrr removeAllListeners 2");
      agoraClient.removeAllListeners();
      agoraClient.leave().catch(console.error);
    };
  }, [AgoraRTC, isSDKLoading]);

  // Enhanced microphone initialization with better error handling
  const initializeMicrophone = async () => {
    if (!AgoraRTC) {
      toast.error('Audio system not ready. Please wait and try again.');
      return;
    }

    try {
      // Check for existing permissions first
      const permissions = await navigator.permissions.query({ name: 'microphone' });

      if (permissions.state === 'denied') {
        toast.error('Microphone permission denied. Please allow microphone access in your browser settings.');
        return;
      }

      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: {
          sampleRate: 48000,
          stereo: true,
          bitrate: 128,
        },
        ANS: true, // Automatic Noise Suppression
        AEC: true, // Acoustic Echo Cancellation
        AGC: true, // Automatic Gain Control
      });

      setLocalAudioTrack(audioTrack);
      setIsMicConnected(true);
      setConnectionError(null);
      toast.success("Microphone connected successfully with noise cancellation!");

      // Monitor audio levels with enhanced detection
      audioTrack.on("audio-volume-indication", (level) => {
        setMicLevel(Math.min(level * 100, 100)); // Normalize to 0-100
      });

    } catch (error) {
      console.error("Error accessing microphone:", error);
      setIsMicConnected(false);
      setConnectionError(`Microphone error: ${error.message}`);

      let errorMessage = "Failed to access microphone. ";
      if (error.name === 'NotAllowedError') {
        errorMessage += "Please allow microphone permissions and try again.";
      } else if (error.name === 'NotFoundError') {
        errorMessage += "No microphone device found. Please check your audio devices.";
      } else if (error.name === 'NotReadableError') {
        errorMessage += "Microphone is being used by another application.";
      } else {
        errorMessage += "Please check your microphone connection and try again.";
      }

      toast.error(errorMessage, { duration: 8000 });
    }
  };

  // Enhanced start broadcast with session tracking and timeout
  const handleStartStream = async () => {
    setLoading(true);
    try {
      if (!isMicConnected) {
        toast.info("Initializing microphone...");
        await initializeMicrophone();

        if (!isMicConnected) {
          toast.error("Cannot start broadcast without microphone access");
          return;
        }
      }

      // Validate environment variables
      const APP_ID = process.env.NEXT_PUBLIC_AGORA_APPID;
      const CHANNEL_NAME = channelName;
      const TOKEN = process.env.NEXT_PUBLIC_AGORA_TOKEN || null;

      if (!APP_ID || !CHANNEL_NAME) {
        toast.error("Broadcast configuration error. Please check environment settings.");
        return;
      }

      // Add connection timeout
      const connectionTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 15000)
      );

      const connectPromise = async () => {
        await client.setClientRole('host');
        const { token, uid } = await generateToken("PUBLISHER", channelName);
        await client.join(APP_ID, CHANNEL_NAME, token, uid);
        await client.publish(localAudioTrack);
      };

      // Race between connection and timeout
      await Promise.race([connectPromise(), connectionTimeout]);

      setIsLive(true);
      setConnectionStatus('connected');
      setStreamDuration(0);
      setReconnectAttempts(0); // Reset on successful start
      setConnectionError(null);
      streamStartTimeRef.current = Date.now();

      // Send session start notification to backend (if you have this endpoint)
      try {
        await fetch('/api/broadcast/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            startTime: streamStartTimeRef.current
          })
        });
      } catch (err) {
        console.log('Session tracking not available:', err);
      }

      toast.success("🎙️ Broadcast started successfully! Listeners can now connect.", {
        duration: 4000
      });

    } catch (error) {
      console.error("Error starting stream:", error);

      // Provide more specific error messages
      let errorMessage = "Failed to start broadcast: ";
      if (error.message.includes('timeout')) {
        errorMessage += "Connection timeout. Please check your network connection.";
      } else if (error.message.includes('INVALID_CHANNEL')) {
        errorMessage += "Invalid channel configuration. Please contact support.";
      } else if (error.message.includes('TOKEN_EXPIRED')) {
        errorMessage += "Session expired. Please refresh the page.";
      } else {
        errorMessage += error.message;
      }

      setConnectionError(errorMessage);
      toast.error(errorMessage, { duration: 8000 });

      // Reset state on failure
      setIsLive(false);
      setConnectionStatus('error');
    } finally {
      setLoading(false);
    }
  };

  // Enhanced stop broadcast with session cleanup
  const handleStopStream = async () => {
    setLoading(true);
    try {
      if (localAudioTrack) {
        await client.unpublish(localAudioTrack);
      }

      await client.leave();

      setIsLive(false);
      setConnectionStatus('disconnected');
      setStreamDuration(0);
      setReconnectAttempts(0);
      setConnectionError(null);

      // Clear reconnect timeout if active
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        setIsReconnecting(false);
      }

      // Send session end notification to backend
      try {
        await fetch('/api/broadcast/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            endTime: Date.now(),
            duration: streamDuration
          })
        });
      } catch (err) {
        console.log('Session tracking not available:', err);
      }

      toast.info("Broadcast stopped. Thank you for your interpretation!", { duration: 4000 });

    } catch (error) {
      console.error("Error stopping stream:", error);
      setConnectionError(`Stop error: ${error.message}`);
      toast.error("Failed to stop stream properly");
    } finally {
      setTimeout(() => {
        setLoading(false);
      }, 4000);
    }
  };

  // Cleanup microphone on unmount
  useEffect(() => {
    return () => {
      if (localAudioTrack) {
        localAudioTrack.close();
      }
    };
  }, [localAudioTrack]);

  // Stream duration timer with pause on disconnect
  useEffect(() => {
    if (!isLive || connectionStatus !== 'connected') return;

    const interval = setInterval(() => {
      setStreamDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive, connectionStatus]);

  // Enhanced listener count monitoring
  useEffect(() => {
    const fetchListenerCount = async () => {
      try {
        const CHANNEL_NAME = channelName;
        const res = await getBroadcastInfoRequest(CHANNEL_NAME);
        const count = res.data?.data?.audience_total || 0;
        const hostcount = res.data?.data?.broadcasters || 0;
        setListenerCount(count);
        setBroadcasterCount(hostcount);

        // Alert if listener count drops significantly while live
        if (isLive && count === 0) {
          console.warn('No listeners detected while broadcasting');
        }
      } catch (error) {
        console.error('Error fetching listener count:', error?.response?.data?.message || error.message);
      }
    };

    fetchListenerCount();
    const interval = setInterval(fetchListenerCount, 3000); // More frequent updates
    return () => clearInterval(interval);
  }, [isLive, channelName]);

  // Initialize microphone on component mount (only after SDK loads)
  useEffect(() => {
    if (!AgoraRTC || isSDKLoading) return;
    initializeMicrophone();
  }, [AgoraRTC, isSDKLoading]);



  // Initialize Pusher
  useEffect(() => {

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });
    const CHANNEL_NAME = channelName;
    const channel = pusher.subscribe(CHANNEL_NAME);
    channel.bind('on-request-to-handover', (data) => {
      console.log(isLiveRef.current, "hello");
      if (isLiveRef.current) {
        setOpenRequestToHandoverPopup(true);
      }
    });

    channel.bind('on-accept-to-handover', (data) => {
      setHandoverRequestResponse("accepted");
    });

    channel.bind('on-reject-to-handover', (data) => {
      setHandoverRequestResponse("rejected");
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(CHANNEL_NAME);
      pusher.disconnect();
    };
  }, [channelName]);


  const sendRequestToHandover = async () => {
    setHandoverRequestResponse(null);
    setWaitingForResponseToHandoverRquestPopup(true);
    const CHANNEL_NAME = channelName;
    await pushMessage("on-request-to-handover", {
      message: "Can you handover the broadcast to me?",
    }, CHANNEL_NAME);
  };

  const sendAcceptToHandover = async () => {
    await handleStopStream()
    setOpenRequestToHandoverPopup(false);
    const CHANNEL_NAME = channelName;
    await pushMessage("on-accept-to-handover", {
      message: "Yes, I will handover the broadcast to you.",
    }, CHANNEL_NAME);
  };

  const sendRejectToHandover = async () => {
    setOpenRequestToHandoverPopup(false);
    const CHANNEL_NAME = channelName;
    await pushMessage("on-reject-to-handover", {
      message: "No, I will not handover the broadcast to you.",
    }, CHANNEL_NAME);
  };

  const handlePlayOtherChannel = async (language) => {
    if (otherChannels[language]?.isPlaying) {
      otherChannels[language]?.audioTrack?.setVolume(0);
      await otherChannels[language]?.audioTrack?.stop();
      setOtherChannels(prev => ({ ...prev, [language]: { ...prev[language], isPlaying: false } }));
      otherChannelsPlayingRef.current[language] = false;
    } else {
      //if the other channel is playing then stop it
      Object.keys(otherChannels).forEach(async (key) => {
        if (otherChannels[key]?.isPlaying) {
          otherChannels[key]?.audioTrack?.setVolume(0);
          await otherChannels[key]?.audioTrack?.stop();
          setOtherChannels(prev => ({ ...prev, [key]: { ...prev[key], isPlaying: false } }));
          otherChannelsPlayingRef.current[key] = false;
        }
      });

      //if the partner audio is playing then stop it
      if (isPartnerAudioPlaying) {
        remoteAudioTrack.setVolume(0);
        await remoteAudioTrack.stop();
        setIsPartnerAudioPlaying(false);
      }


      otherChannels[language]?.audioTrack?.setVolume(100);
      await otherChannels[language]?.audioTrack?.play();
      setOtherChannels(prev => ({ ...prev, [language]: { ...prev[language], isPlaying: true } }));
      otherChannelsPlayingRef.current[language] = true;
    }
  };

  const handleSelectLanguage = (language) => {
    setSelectedLanguage(language);
    setLanguage(language);
    if (isLiveRef.current) {
      handleStopStream();
    }
  };


  // Utility functions
  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getNetworkColor = () => {
    switch (networkQuality) {
      case 'good': return 'text-green-600';
      case 'fair': return 'text-yellow-600';
      case 'poor': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getConnectionStatusConfig = () => {
    if (isReconnecting) {
      return {
        icon: Clock,
        text: `Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`,
        className: 'text-blue-600 bg-blue-50',
        iconClass: 'text-blue-600 animate-spin'
      };
    }

    switch (connectionStatus) {
      case 'connected':
        return {
          icon: CheckCircle,
          text: 'Connected',
          className: 'text-green-600 bg-green-50',
          iconClass: 'text-green-600'
        };
      case 'reconnecting':
        return {
          icon: RefreshCcw,
          text: 'Reconnecting',
          className: 'text-blue-600 bg-blue-50',
          iconClass: 'text-blue-600 animate-spin'
        };
      case 'error':
        return {
          icon: AlertCircle,
          text: 'Connection Failed',
          className: 'text-red-600 bg-red-50',
          iconClass: 'text-red-600'
        };
      default:
        return {
          icon: AlertCircle,
          text: 'Disconnected',
          className: 'text-gray-600 bg-gray-50',
          iconClass: 'text-gray-600'
        };
    }
  };

  const handleMicToggle = async () => {
    if (isMicConnected) {
      if (localAudioTrack) {
        localAudioTrack.close();
        setLocalAudioTrack(null);
      }
      setIsMicConnected(false);
      toast.warning("Microphone disconnected");
    } else {
      await initializeMicrophone();
    }
  };

  const handleReconnect = async () => {
    toast.info("Attempting to reconnect microphone...");
    await initializeMicrophone();
  };

  const handleForceReconnect = async () => {
    if (isLive) {
      setReconnectAttempts(0);
      setConnectionError(null);
      handleConnectionLoss();
    }
  };

  const handlePartnerAudio = async () => {
    console.log(remoteAudioTrack, "remoteAudioTrack");
    if (isPartnerAudioPlaying) {
      console.log("stop");
      remoteAudioTrack.setVolume(0);
      await remoteAudioTrack.stop();
      setIsPartnerAudioPlaying(false);
    } else {
      console.log("play");
      remoteAudioTrack.setVolume(100);
      await remoteAudioTrack.play();
      setIsPartnerAudioPlaying(true);

      //if the other audio playing then stop it
      Object.keys(otherChannels).forEach(async (key) => {
        if (otherChannels[key]?.isPlaying) {
          otherChannels[key]?.audioTrack?.setVolume(0);
          await otherChannels[key]?.audioTrack?.stop();
          setOtherChannels(prev => ({ ...prev, [key]: { ...prev[key], isPlaying: false } }));
          otherChannelsPlayingRef.current[key] = false;
        }
      });
    }
  };

  const handleSelectOtherChannel = (value) => {
    setSelectedOtherChannel(value);
    handlePlayOtherChannel(value);
  };

  const statusConfig = getConnectionStatusConfig();
  const StatusIcon = statusConfig.icon;

  // Loading component for async SDK loading
  const LoadingComponent = () => (
    <div className="min-h-screen bg-zero-beige flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-zero-blue border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-xl font-inter font-semibold text-zero-text mb-2">
          Loading Broadcasting System
        </h2>
        <p className="text-zero-text/70 font-inter">
          Initializing professional audio streaming components...
        </p>
      </div>
    </div>
  );

  // Error component for SDK loading failure
  const ErrorComponent = () => (
    <div className="min-h-screen bg-zero-beige flex items-center justify-center">
      <div className="text-center max-w-md mx-auto p-8">
        <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-600" />
        <h2 className="text-xl font-inter font-semibold text-zero-text mb-2">
          Broadcasting System Unavailable
        </h2>
        <p className="text-zero-text/70 font-inter mb-6">
          Failed to load broadcasting components: {sdkError || connectionError}
        </p>
        <div className="space-y-3">
          <Button
            onClick={() => window.location.reload()}
            className="w-full bg-zero-blue text-white hover:bg-zero-blue/90 font-inter font-semibold"
          >
            Refresh Page
          </Button>
          <p className="text-xs text-gray-600">
            If the problem persists, try a different browser or check your network connection
          </p>
        </div>
      </div>
    </div>
  );

  // Show loading component while SDK is loading
  if (isSDKLoading) {
    return <LoadingComponent />;
  }

  // Show error component if SDK failed to load
  if (sdkError) {
    return <ErrorComponent />;
  }

  return (
    <div className='monstant-font'>
      {
        waitingForResponseToHandoverRquestPopup && (
          <Dialog>
            {
              handoverRequestResponse === "accepted" ? (
                <>
                  <p className='text-sm text-green-500 text-center mb-5'>Handover request accepted</p>
                  <Button onClick={() => { setWaitingForResponseToHandoverRquestPopup(false); handleStartStream() }} className='bg-zero-green text-white hover:bg-zero-green/90'>On Air</Button>
                </>
              )
                : (handoverRequestResponse === "rejected") ? (
                  <>
                    <p className='text-sm text-red-500 text-center mb-5'>Handover request rejected</p>
                    <Button onClick={() => setWaitingForResponseToHandoverRquestPopup(false)} className='bg-gray-600 text-white hover:bg-gray-600/90'>Close</Button>
                  </>
                ) : (
                  <>
                    <p className='text-sm text-gray-500 text-center mb-5'>Waiting for response from the other broadcaster</p>
                  </>
                )}
          </Dialog>
        )
      }
      {
        openRequestToHandoverPopup && (
          <Dialog>
            <h1 className='text-2xl font-bold text-center'>Request to Handover</h1>
            <p className='text-sm text-gray-500 text-center'>Handover request received from the other broadcaster. Please accept or reject the request.</p>
            <div className='flex items-center gap-5 w-full justify-center mt-5'>
              <Button onClick={sendAcceptToHandover} className='bg-zero-green text-white hover:bg-zero-green/90'>Accept</Button>
              <Button onClick={sendRejectToHandover} className='bg-red-500 text-white hover:bg-red-500/90'>Reject</Button>
            </div>
          </Dialog>
        )
      }
      <div className="min-h-screen bg-zero-beige ">
        {/* Modern Header */}
        <header className="bg-gray-200 text-white p-6 sticky top-0 z-50 backdrop-blur-xl border-b border-white/10">
          <div className="container mx-auto flex justify-between items-center">
            <div className="flex items-center gap-6">
              <img src="/images/lingo-you-logo.png" alt="logo" className="w-[12rem] object-contain" />
            </div>

            <div className="flex items-center gap-6">
              {/* Connection Status in Header */}
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${statusConfig.className}`}>
                <StatusIcon className={`w-4 h-4 ${statusConfig.iconClass}`} />
                {statusConfig.text}
              </div>
              {isLive && <OnAirIndicator isLive={isLive} />}
              {isLive && <ListenerCountBadge count={listenerCount} />}
            </div>
          </div>
        </header>

        {/* Connection Alert Banner */}
        {(isReconnecting || connectionStatus === 'error' || connectionError) && (
          <div className={`w-full p-4 ${isReconnecting ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'
            } border-b`}>
            <div className="container mx-auto flex items-center gap-3">
              <StatusIcon className={`h-5 w-5 ${statusConfig.iconClass}`} />
              <div>
                <p className={`font-semibold ${isReconnecting ? 'text-blue-800' : 'text-red-800'
                  }`}>
                  {isReconnecting
                    ? 'Reconnecting to broadcast service...'
                    : 'Broadcast service connection failed'
                  }
                </p>
                <p className={`text-sm ${isReconnecting ? 'text-blue-600' : 'text-red-600'
                  }`}>
                  {connectionError || (isReconnecting
                    ? 'Your broadcast will resume automatically. Listeners will reconnect when service is restored.'
                    : 'Please check your connection and try restarting the broadcast.'
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="container mx-auto p-8 max-w-7xl">
          {/* Status Cards Row */}
          {/* <div className="grid gap-8 md:grid-cols-4 mb-12">
        
            <Card className="bg-white/90 backdrop-blur-xl shadow-xl border-0 rounded-3xl">
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="p-4 bg-red-50 rounded-2xl">
                    <Radio className="h-8 w-8 text-red-600" />
                  </div>
                  <div className={`w-5 h-5 rounded-full ${isLive ? 'bg-zero-status-good animate-pulse' : 'bg-gray-400'}`} />
                </div>

                <div className="space-y-3">
                  <div className="text-3xl font-playfair font-bold text-zero-text">
                    {isLive ? 'LIVE' : 'OFFLINE'}
                  </div>
                  {isLive && (
                    <div className="text-sm text-zero-text/70 font-inter font-medium">
                      Duration: {formatDuration(streamDuration)}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card className="bg-white/90 backdrop-blur-xl shadow-xl border-0 rounded-3xl">
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className={`p-4 rounded-2xl ${isMicConnected ? 'bg-emerald-50' : 'bg-orange-50'}`}>
                    {isMicConnected ?
                      <Mic className="h-8 w-8 text-emerald-600" /> :
                      <MicOff className="h-8 w-8 text-orange-600" />
                    }
                  </div>
                  <Button
                    onClick={handleReconnect}
                    size="sm"
                    variant="outline"
                    className="text-xs font-medium"
                    disabled={isMicConnected}
                  >
                    <RefreshCcw className="h-4 w-4 mr-1" />
                    {isMicConnected ? 'Connected' : 'Reconnect'}
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className={`text-lg font-bold font-inter ${isMicConnected ? 'text-zero-status-good' : 'text-zero-warning'}`}>
                    {isMicConnected ? 'Connected' : 'Not Detected'}
                  </div>
                  <div className="text-xs text-zero-text/60 font-inter">
                    {isMicConnected ? 'Audio input ready' : 'Check permissions'}
                  </div>
                </div>
              </div>
            </Card>
            
            <Card className="bg-white/90 backdrop-blur-xl shadow-xl border-0 rounded-3xl">
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="p-4 bg-blue-50 rounded-2xl">
                    <Users className="h-8 w-8 text-blue-600" />
                  </div>
                  <Monitor className="h-6 w-6 text-zero-blue" />
                </div>

                <div className="space-y-3">
                  <div className="text-3xl font-playfair font-bold text-zero-text">
                    {listenerCount}
                  </div>
                  <div className="text-sm text-zero-text/70 font-inter font-medium">
                    {listenerCount === 1 ? 'listener' : 'listeners'}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="bg-white/90 backdrop-blur-xl shadow-xl border-0 rounded-3xl">
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="p-4 bg-emerald-50 rounded-2xl">
                    <Wifi className="h-8 w-8 text-emerald-600" />
                  </div>
                  <Signal className={`h-6 w-6 ${getNetworkColor()}`} />
                </div>

                <div className="space-y-3">
                  <div className={`text-lg font-bold font-inter ${getNetworkColor()}`}>
                    {networkQuality}
                  </div>
                  <div className="text-xs text-zero-text/60 font-inter">
                    Network Quality
                  </div>
                </div>
              </div>
            </Card>
          </div> */}

          <div className="grid gap-10 lg:grid-cols-2">
            {/* Main Controls */}
            <Card className="bg-white/90 backdrop-blur-xl shadow-2xl border-0 rounded-3xl overflow-hidden">
              <div className="px-10 py-5">
                <h3 className="text-4xl font-playfair font-bold text-zero-text mb-10 text-left">
                  Outgoing Audio Controls
                </h3>

                <div className="space-y-10">
                  {/* Main Action Button */}
                  {
                    twoWayLanguages[language] && (
                      <div className="bg-gray-300 grid grid-cols-2 gap-0">
                        <Button
                          onClick={() => handleSelectLanguage(language)}
                          className={`px-2 py-2 cursor-pointer text-white ${selectedLanguage !== 'italian' ? 'bg-zero-green hover:bg-zero-green/90' : 'bg-gray-300 text-zero-text hover:bg-gray-300/90'}`}
                          size="lg"
                        >
                          {language?.slice(0, 1).toUpperCase()}{language?.slice(1).toLowerCase()}
                        </Button>
                        <Button
                          onClick={() => handleSelectLanguage('italian')}
                          className={`px-2 py-2 cursor-pointer text-white ${selectedLanguage === 'italian' ? 'bg-zero-green hover:bg-zero-green/90' : 'bg-gray-300 text-zero-text hover:bg-gray-300/90'}`}
                          size="lg"
                        >
                          Italian
                        </Button>
                      </div>
                    )
                  }
                  <div className="text-center">
                    {
                      loading ? (
                        <Button
                          className="w-full  bg-zero-green text-white hover:bg-zero-green/90 text-2xl px-12 py-10 font-bold transition-all duration-300 hover:scale-105 font-inter rounded-2xl shadow-xl"
                          size="lg"
                        >
                          <Loader2 className="mr-4 h-10 w-10 animate-spin" />
                        </Button>
                      ) : (broadcasterCount > 1 && !isLive && !loading) ? (
                        <Button
                          onClick={sendRequestToHandover}
                          className="w-full bg-zero-green text-white hover:bg-zero-green/90 text-2xl px-12 py-10 font-bold transition-all duration-300 hover:scale-105 font-inter rounded-2xl shadow-xl"
                          size="lg"
                        >
                          Request Handover
                        </Button>
                      ) : !isLive ? (
                        <Button
                          onClick={handleStartStream}
                          disabled={!isMicConnected || isReconnecting}
                          className="w-full bg-zero-green text-white hover:bg-zero-green/90 text-2xl px-12 py-10 font-bold transition-all duration-300 hover:scale-105 font-inter rounded-2xl shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                          size="lg"
                        >
                          <Mic className="mr-4 h-20 w-20" />
                          On Air
                        </Button>
                      ) : (
                        <Button
                          onClick={handleStopStream}
                          variant="outline"
                          className="w-full border-zero-warning text-zero-warning hover:bg-zero-warning hover:text-white text-2xl px-12 py-10 font-bold font-inter rounded-2xl shadow-xl"
                          size="lg"
                        >
                          <MicOff className="mr-4 h-20 w-20" />
                          Off Air
                        </Button>
                      )}
                  </div>

                  {/* Connection Controls */}
                 {/* 
{(connectionStatus === 'error' || isReconnecting || connectionError) && (
  <div className="space-y-4">
    <Button
      onClick={handleForceReconnect}
      className="w-full bg-blue-600 text-white hover:bg-blue-700 font-inter font-semibold py-4 rounded-xl"
      disabled={isReconnecting}
    >
      <RefreshCcw className={`mr-2 h-5 w-5 ${isReconnecting ? 'animate-spin' : ''}`} />
      {isReconnecting ? 'Reconnecting...' : 'Force Reconnect'}
    </Button>
    {connectionError && (
      <div className="text-center bg-red-50 p-4 rounded-xl">
        <p className="text-sm text-red-600">{connectionError}</p>
      </div>
    )}
  </div>
)}
*/}


                  {!isMicConnected && (
                    <div className="text-center bg-orange-50 p-8 rounded-3xl border border-orange-200">
                      <MicOff className="h-12 w-12 mx-auto mb-4 text-orange-600" />
                      <p className="text-orange-800 font-bold text-lg font-inter">Microphone Required</p>
                      <p className="text-sm text-orange-600 mt-2 font-inter">Connect your microphone to start broadcasting</p>
                      <Button
                        onClick={handleReconnect}
                        className="mt-4 bg-orange-600 text-white hover:bg-orange-700 font-inter font-semibold px-6 py-2 rounded-xl"
                      >
                        <Mic className="mr-2 h-4 w-4" />
                        Retry Connection
                      </Button>
                    </div>
                  )}

                  {/* Audio Monitor */}
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-2xl font-playfair font-bold text-zero-text">
                        Audio Monitor
                      </h4>
                      <Button
                        onClick={handleMicToggle}
                        variant="outline"
                        size="sm"
                        className="border-zero-navy text-zero-navy hover:bg-zero-navy hover:text-white font-inter font-medium"
                        disabled={isLive}
                      >
                        {isMicConnected ? 'Disconnect' : 'Connect'}
                      </Button>
                    </div>

                    <AudioLevelMeter
                      level={micLevel}
                      isActive={isMicConnected}
                      className="mb-6"
                      mediaStreamTrack={localAudioTrack?.getMediaStreamTrack() || undefined}
                    />

                    <p className="text-sm text-zero-text/60 font-inter text-center">
                      {isMicConnected ?
                        'Speak into your microphone to test the audio levels' :
                        'Connect microphone to monitor audio levels'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </Card>






            {/* Stream Information */}
            <Card className="bg-white/90 backdrop-blur-xl shadow-2xl border-0 rounded-3xl overflow-hidden">
              <div className="px-10 py-5">
                <h3 className="text-4xl font-playfair font-bold text-zero-text mb-10">
                  Incoming Audio
                </h3>

                <div className="space-y-8">
                  {
                    !isLive && (
                      <div className='grid grid-cols-2 gap-2'>

                        <div className="p-4 bg-gray-50 rounded-2xl flex items-center justify-between flex-col">
                          <span className="text-zero-text font-medium block text-2xl mb-4">Partner Audio</span>
                          <Button
                            disabled={!remoteAudioTrack}
                            onClick={handlePartnerAudio}
                            variant="outline"
                            size="icon"
                            className="border-zero-navy disabled:opacity-50 disabled:cursor-not-allowed bg-zero-green text-white hover:bg-zero-green hover:text-white font-inter font-medium border-none rounded-full cursor-pointer"
                          >
                            {isPartnerAudioPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
                          </Button>

                          {
                            !remoteAudioTrack ? (
                              <span className="text-zero-text/70 block mt-5">No Partner is Live</span>
                            ) : (
                              <span className="text-zero-text/70 block mt-5">Partner is Live</span>
                            )
                          }
                        </div>

                        <div className="p-4 bg-gray-50 rounded-2xl">
                          <span className="text-zero-text font-bold block mb-1 uppercase">Relay Channel</span>
                          <div className='h-[8rem] rounded-2xl overflow-y-auto overflow-x-visible p-2 space-y-2'>
                            {
                              otherLanguageChannel.filter((lang) => (lang.value !== language)).length > 0 ? (
                                otherLanguageChannel.filter((lang) => (lang.value !== language)).map((language) => (
                                  <div key={language.value} className='flex items-center gap-2 justify-between relative px-1'>
                                    {
                                      otherChannels[language.value]?.isLive && (
                                        <span className='h-2 w-2 rounded-full bg-blue-500 absolute top-1/2 -left-2 -translate-y-1/2 animate-pulse'></span>
                                      )
                                    }
                                    <h3 className='flex items-center gap-2'><img src={language.flag} alt={language.value} className='w-5 h-5' />
                                      {language.name}</h3>

                                    <Button
                                      onClick={() => handlePlayOtherChannel(language.value)}
                                      variant="outline"
                                      size="icon"
                                      className="border-zero-navy disabled:opacity-50 disabled:cursor-not-allowed bg-zero-green text-white hover:bg-zero-green hover:text-white font-inter font-medium border-none rounded-full cursor-pointer h-7 w-7"
                                      disabled={!otherChannels[language.value]?.isLive}
                                    >
                                      {otherChannels[language.value]?.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                                    </Button>
                                  </div>
                                ))
                              ) : (
                                <span className="text-zero-text/70 block mt-5">No Relay Channel</span>
                              )
                            }
                          </div>
                        </div>
                      </div>
                    )
                  }

                  {
                    isLive && (
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text font-bold block mb-1 uppercase">Relay Channel</span>
                        <div className='h-[8rem] rounded-2xl overflow-y-auto overflow-x-visible p-2 space-y-2'>
                          {
                            otherLanguageChannel.filter((lang) => (lang.value !== language)).length > 0 ? (
                              otherLanguageChannel.filter((lang) => (lang.value !== language)).map((language) => (
                                <div key={language.value} className='flex items-center gap-2 justify-between relative px-1'>
                                  {
                                    otherChannels[language.value]?.isLive && (
                                      <span className='h-2 w-2 rounded-full bg-blue-500 absolute top-1/2 -left-2 -translate-y-1/2 animate-pulse'></span>
                                    )
                                  }
                                  <h3 className='flex items-center gap-2'><img src={language.flag} alt={language.value} className='w-5 h-5' />
                                    {language.name}</h3>

                                  <Button
                                    onClick={() => handlePlayOtherChannel(language.value)}
                                    variant="outline"
                                    size="icon"
                                    className="border-zero-navy disabled:opacity-50 disabled:cursor-not-allowed bg-zero-green text-white hover:bg-zero-green hover:text-white font-inter font-medium border-none rounded-full cursor-pointer h-7 w-7"
                                    disabled={!otherChannels[language.value]?.isLive}
                                  >
                                    {otherChannels[language.value]?.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                                  </Button>
                                </div>
                              ))
                            ) : (
                              <span className="text-zero-text/70 block mt-5">No Relay Channel</span>
                            )
                          }
                        </div>
                      </div>
                    )
                  }

                  <div className="grid grid-cols-2 gap-6 text-sm font-inter">

                    <div className="space-y-6">
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text/70 font-medium block mb-1">Stream Status</span>
                        <div className={`font-bold text-lg ${isLive ? 'text-zero-status-good' : 'text-gray-600'}`}>
                          {isLive ? 'Broadcasting' : 'Offline'}
                        </div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text/70 font-medium block mb-1">Language</span>
                        <div className="font-bold text-lg text-zero-text flex items-center gap-2"><img src={flagsMapping[language]} alt={language} className='w-6 h-6' />{language?.slice(0, 1).toUpperCase()}{language?.slice(1).toLowerCase()}</div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text/70 font-medium block mb-1">Mic Status</span>
                        <div className={`font-bold text-lg ${isMicConnected ? 'text-zero-status-good' : 'text-zero-warning'}`}>
                          {isMicConnected ? 'Connected' : 'Disconnected'}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text/70 font-medium block mb-1">Connection</span>
                        <div className={`font-bold text-lg ${getNetworkColor()}`}>
                          {networkQuality}
                        </div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text/70 font-medium block mb-1">Listeners</span>
                        <div className="font-bold text-lg text-zero-text">{listenerCount}</div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <span className="text-zero-text/70 font-medium block mb-1">Duration</span>
                        <div className="font-bold text-lg text-zero-text">{formatDuration(streamDuration)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Live Stats */}
                  {/* {isLive && (
                    <div className="border-t border-gray-200 pt-8">
                      <h4 className="font-playfair font-bold text-zero-text mb-6 text-2xl flex items-center gap-3">
                        <Activity className="h-6 w-6" />
                        Live Statistics
                      </h4>
                      <div className="space-y-4 text-sm font-inter">
                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl">
                          <span className="text-zero-text/70 font-medium">Connection Status</span>
                          <span className={`font-bold text-lg ${connectionStatus === 'connected' ? 'text-zero-status-good' : 'text-zero-warning'}`}>
                            {connectionStatus === 'connected' ? 'Stable' : 'Reconnecting'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50 to-green-50 rounded-xl">
                          <span className="text-zero-text/70 font-medium">Network Quality</span>
                          <span className={`font-bold text-lg ${getNetworkColor()}`}>
                            {networkQuality}
                          </span>
                        </div>
                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50 to-emerald-50 rounded-xl">
                          <span className="text-zero-text/70 font-medium">Reconnection Attempts</span>
                          <span className="font-bold text-lg text-zero-text">
                            {reconnectAttempts}/{maxReconnectAttempts}
                          </span>
                        </div>
                        <div className="flex justify-between items-center p-4 bg-gradient-to-r from-gray-50 to-purple-50 rounded-xl">
                          <span className="text-zero-text/70 font-medium">Session ID</span>
                          <span className="font-mono text-xs text-zero-text/80">
                            {sessionId?.slice(-8) || 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )} */}

                  {/* Connection Issues Warning */}
                  {(connectionStatus === 'error' || reconnectAttempts >= maxReconnectAttempts || connectionError) && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                      <div className="flex items-center gap-3 mb-3">
                        <AlertCircle className="h-5 w-5 text-red-600" />
                        <span className="font-bold text-red-800">Critical Connection Issues</span>
                      </div>
                      <p className="text-sm text-red-700 mb-4">
                        {connectionError || 'The broadcast has experienced connection problems. Listeners may be affected.'}
                      </p>
                      <Button
                        onClick={handleStopStream}
                        className="w-full bg-red-600 text-white hover:bg-red-700 font-inter font-semibold py-2 rounded-xl"
                      >
                        Stop and Restart Broadcast
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>




          </div>

        </main>
      </div>
    </div>
  );
};

export default Broadcast;