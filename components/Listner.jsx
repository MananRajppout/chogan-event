import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Volume, VolumeX, ArrowLeft, Play, Pause, Radio, Signal, Headphones, Users, Wifi, Globe, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import debounce from 'lodash/debounce';
import { getBroadcastInfoRequest } from '@/http/agoraHttp';

// ⚡ IMMEDIATE UI COMPONENTS
const OnAirIndicator = lazy(() => import('@/components/OnAirIndicator'));
const AudioLevelMeter = lazy(() => import('@/components/AudioLevelMeter'));
const ListenerCountBadge = lazy(() => import('@/components/ListenerCountBadge'));

// ⚡ CRITICAL: Aggressive Agora SDK loading
let agoraSDKPromise = null;
const loadAgoraSDK = () => {
  if (!agoraSDKPromise && typeof window !== 'undefined') {
    agoraSDKPromise = import('agora-rtc-sdk-ng')
      .then(module => module.default)
      .catch(error => {
        console.error('Failed to load Agora SDK:', error);
        throw error;
      });
  }
  return agoraSDKPromise;
};

const Listner = () => {
  // ⚡ IMMEDIATE STATE
  const [isConnected, setIsConnected] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [volume, setVolume] = useState(75);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);

  // 🚨 CRITICAL ERROR TRACKING
  const [connectionError, setConnectionError] = useState(null);
  const [isSDKLoading, setIsSDKLoading] = useState(true);
  const [sdkError, setSdkError] = useState(null);
  const [AgoraRTC, setAgoraRTC] = useState(null);
  const [client, setClient] = useState(null);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState(null);
  const [remoteMediaStreamTrack, setRemoteMediaStreamTrack] = useState(undefined);

  // 🚨 ENHANCED RECONNECTION
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [wasPlayingBeforeDisconnect, setWasPlayingBeforeDisconnect] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [lastKnownBroadcasterState, setLastKnownBroadcasterState] = useState(null);
  const [broadcasterOnline, setBroadcasterOnline] = useState(false);

  // 🚨 CRITICAL: iOS detection (simplified)
  const [isIOS] = useState(() => {
    if (typeof navigator !== 'undefined') {
      return /iPad|iPhone|iPod/.test(navigator.userAgent);
    }
    return false;
  });

  // 🚨 AGGRESSIVE SETTINGS
  const maxReconnectAttempts = 20; // Increased significantly
  const heartbeatInterval = 1500; // Faster heartbeat

  const isComponentMountedRef = useRef(true);
  const hasShownConnectedToastRef = useRef(false);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const connectionCheckIntervalRef = useRef(null);

  // 🚨 EMERGENCY: Load SDK immediately, no delays
  useEffect(() => {
    let isMounted = true;

    const initializeSDK = async () => {
      try {
        setConnectionError(null);
        console.log('🚨 EMERGENCY: Loading Agora SDK...');
        
        const sdk = await loadAgoraSDK();
        
        if (isMounted) {
          setAgoraRTC(sdk);
          setIsSDKLoading(false);
          console.log('✅ Agora SDK loaded successfully');
        }
      } catch (error) {
        console.error('🚨 CRITICAL: SDK Load failed:', error);
        if (isMounted) {
          setSdkError(error.message);
          setConnectionError('Failed to load streaming system');
          setIsSDKLoading(false);
          toast.error('Failed to load streaming system. Please refresh the page.');
        }
      }
    };

    // 🚨 NO DELAYS - Load immediately
    initializeSDK();

    return () => {
      isMounted = false;
    };
  }, []);

  // 🚨 CRITICAL: Enhanced broadcaster detection
  const checkBroadcasterStatus = useCallback(async () => {
    try {
      console.log('🔍 Checking broadcaster status...');
      const res = await getBroadcastInfoRequest();
      const data = res.data?.data;
      
      if (data) {
        const currentListeners = data.audience_total || 0;
        const hostOnline = data.host_online === true;
        
        setListenerCount(currentListeners);
        setBroadcasterOnline(hostOnline);
        
        console.log('📊 Broadcaster status:', {
          hostOnline,
          listeners: currentListeners,
          hasAudioTrack: !!remoteAudioTrack,
          isConnected,
          isLive
        });

        // 🚨 CRITICAL: Fix "waiting for broadcaster" issue
        if (hostOnline && isConnected && !isLive && !remoteAudioTrack) {
          console.log('🚨 CRITICAL: Broadcaster online but no audio track - forcing reconnection');
          setConnectionError('Broadcaster detected but audio not received - reconnecting...');
          if (!isReconnecting && reconnectCount < maxReconnectAttempts) {
            attemptReconnection();
          }
        }

        // Clear errors if broadcaster comes online
        if (hostOnline && connectionError) {
          setConnectionError(null);
        }
      }
    } catch (error) {
      console.error('❌ Broadcaster status check failed:', error);
      if (!isReconnecting) {
        setConnectionError('Unable to check broadcaster status');
      }
    }
  }, [isConnected, isLive, remoteAudioTrack, isReconnecting, reconnectCount, connectionError]);

  // 🚨 CRITICAL: Aggressive reconnection
  const attemptReconnection = useCallback(async () => {
    if (!client || !isComponentMountedRef.current || reconnectCount >= maxReconnectAttempts) {
      console.log('🚨 Reconnection stopped:', { client: !!client, mounted: isComponentMountedRef.current, attempts: reconnectCount });
      return;
    }

    setIsReconnecting(true);
    setReconnectCount(prev => prev + 1);
    setConnectionError(null);

    console.log(`🔄 Attempting reconnection ${reconnectCount + 1}/${maxReconnectAttempts}`);

    // Faster reconnection - shorter delays
    const delay = Math.min(500 * Math.pow(1.2, reconnectCount), 3000);

    reconnectTimeoutRef.current = setTimeout(async () => {
      if (!isComponentMountedRef.current) return;

      try {
        const APP_ID = process.env.NEXT_PUBLIC_AGORA_APPID;
        const CHANNEL_NAME = process.env.NEXT_PUBLIC_CHANNEL_NAME;
        const TOKEN = process.env.NEXT_PUBLIC_AGORA_TOKEN || null;

        console.log('🔧 Reconnection config:', { APP_ID: !!APP_ID, CHANNEL_NAME: !!CHANNEL_NAME, TOKEN: !!TOKEN });

        if (!APP_ID || !CHANNEL_NAME) {
          throw new Error('Missing Agora configuration');
        }

        // Force clean reconnection
        await client.leave().catch(() => {});
        await client.setClientRole('audience');
        await client.join(APP_ID, CHANNEL_NAME, TOKEN);
        
        setIsConnected(true);
        setIsReconnecting(false);
        setReconnectCount(0);
        setConnectionError(null);
        
        console.log('✅ Reconnection successful');
        toast.success('Reconnected successfully!', { id: 'reconnected' });

      } catch (error) {
        console.error(`❌ Reconnection ${reconnectCount + 1} failed:`, error);
        setConnectionError(`Reconnection failed: ${error.message}`);
        
        if (reconnectCount < maxReconnectAttempts - 1) {
          console.log('🔄 Scheduling next reconnection attempt...');
          attemptReconnection();
        } else {
          setIsReconnecting(false);
          setConnectionError('Connection failed after maximum attempts. Please refresh the page.');
          toast.error('Connection failed. Please refresh the page.', { 
            id: 'reconnect-failed',
            action: {
              label: 'Refresh',
              onClick: () => window.location.reload()
            }
          });
        }
      }
    }, delay);
  }, [client, reconnectCount, maxReconnectAttempts]);

  // 🚨 CRITICAL: Handle disconnection with immediate response
  const handleDisconnection = useCallback(() => {
    if (!isComponentMountedRef.current) return;

    console.log('🚨 Connection lost detected');
    setWasPlayingBeforeDisconnect(isPlaying);
    setIsConnected(false);
    setIsLive(false);
    setIsPlaying(false);
    setConnectionError('Connection lost - attempting to reconnect...');
    
    if (remoteAudioTrack) {
      remoteAudioTrack.stop();
      setRemoteAudioTrack(null);
    }
    setRemoteMediaStreamTrack(undefined);

    if (!isReconnecting && reconnectCount < maxReconnectAttempts) {
      toast.info('Connection lost. Reconnecting...', { id: 'reconnecting' });
      attemptReconnection();
    }
  }, [isPlaying, remoteAudioTrack, isReconnecting, reconnectCount, attemptReconnection, maxReconnectAttempts]);

  // 🚨 CRITICAL: Enhanced Agora client setup
  useEffect(() => {
    if (!AgoraRTC || isSDKLoading) return;

    console.log('🚀 Initializing Agora client...');

    const agoraClient = AgoraRTC.createClient({
      mode: 'live',
      codec: 'vp8',
      role: 'audience'
    });
    setClient(agoraClient);

    // 🚨 CRITICAL: Enhanced event handlers
    agoraClient.on('user-published', async (user, mediaType) => {
      console.log('👤 User published:', user.uid, mediaType);
      
      if (mediaType === 'audio' && isComponentMountedRef.current) {
        try {
          console.log('🎵 Subscribing to audio...');
          await agoraClient.subscribe(user, mediaType);
          const audioTrack = user.audioTrack;
          const track = audioTrack.getMediaStreamTrack();
          
          audioTrack.setVolume(isMuted ? 0 : volume);
          
          setRemoteMediaStreamTrack(track);
          setRemoteAudioTrack(audioTrack);
          setIsLive(true);
          setConnectionError(null);
          
          console.log('✅ Audio track received and configured');
          
          // Auto-resume if was playing before
          if (wasPlayingBeforeDisconnect) {
            try {
              await audioTrack.play();
              setIsPlaying(true);
              setWasPlayingBeforeDisconnect(false);
              toast.success('Audio resumed automatically', { id: 'auto-resume' });
            } catch (playError) {
              console.log('Auto-resume failed, manual play required:', playError);
            }
          }
          
          if (!isReconnecting) {
            toast.success("🎙️ Broadcaster is live!", { id: 'broadcaster-live' });
          }
        } catch (error) {
          console.error('❌ Error subscribing to audio:', error);
          setConnectionError(`Failed to connect to audio: ${error.message}`);
          toast.error("Failed to connect to broadcaster audio", { id: 'connection-error' });
        }
      }
    });

    agoraClient.on('user-unpublished', (user, mediaType) => {
      console.log('👤 User unpublished:', user.uid, mediaType);
      
      if (mediaType === 'audio' && isComponentMountedRef.current) {
        setIsLive(false);
        setIsPlaying(false);
        if (!isReconnecting) {
          toast.info("Broadcaster stopped", { id: 'broadcaster-stopped' });
        }
      }
    });

    agoraClient.on('connection-state-changed', (curState, revState, reason) => {
      console.log('🔄 Connection state changed:', curState, 'from:', revState, 'reason:', reason);
      
      if (curState === 'CONNECTED') {
        setConnectionError(null);
        setIsConnected(true);
      } else if (curState === 'DISCONNECTED' && isConnected && !isReconnecting) {
        handleDisconnection();
      } else if (curState === 'FAILED') {
        setConnectionError(`Connection failed: ${reason}`);
        handleDisconnection();
      } else if (curState === 'RECONNECTING') {
        setConnectionError('Connection unstable, reconnecting...');
      }
    });

    agoraClient.on('exception', (evt) => {
      console.error('🚨 Agora exception:', evt);
      setConnectionError(`Stream error: ${evt.code} - ${evt.msg || 'Unknown error'}`);
      
      if ((evt.code === 'NETWORK_ERROR' || evt.code === 'UNEXPECTED_ERROR') && isConnected && !isReconnecting) {
        handleDisconnection();
      }
    });

    // 🚨 CRITICAL: Join channel with comprehensive error handling
    const joinChannel = async () => {
      try {
        console.log('🔗 Joining channel...');
        const APP_ID = process.env.NEXT_PUBLIC_AGORA_APPID;
        const CHANNEL_NAME = process.env.NEXT_PUBLIC_CHANNEL_NAME;
        const TOKEN = process.env.NEXT_PUBLIC_AGORA_TOKEN || null;

        console.log('🔧 Channel config:', { 
          APP_ID: APP_ID ? 'Set' : 'Missing', 
          CHANNEL_NAME: CHANNEL_NAME ? 'Set' : 'Missing',
          TOKEN: TOKEN ? 'Set' : 'None'
        });

        if (!APP_ID || !CHANNEL_NAME) {
          throw new Error('Missing required Agora configuration (APP_ID or CHANNEL_NAME)');
        }

        await agoraClient.setClientRole('audience');
        await agoraClient.join(APP_ID, CHANNEL_NAME, TOKEN);
        
        if (isComponentMountedRef.current && !hasShownConnectedToastRef.current) {
          setIsConnected(true);
          setConnectionError(null);
          hasShownConnectedToastRef.current = true;
          
          console.log('✅ Successfully joined channel');
          toast.success("Connected to interpretation service", { id: 'channel-connected' });
          
          // Start monitoring
          startHeartbeat();
        }
      } catch (error) {
        console.error("❌ Error joining channel:", error);
        if (isComponentMountedRef.current) {
          setConnectionError(`Failed to join: ${error.message}`);
          toast.error("Failed to connect to interpretation service", { id: 'channel-error' });
          
          // 🚨 CRITICAL: Retry connection
          setTimeout(() => {
            if (isComponentMountedRef.current && !isConnected) {
              console.log('🔄 Retrying channel join...');
              joinChannel();
            }
          }, 2000);
        }
      }
    };

    joinChannel();

    return () => {
      console.log('🧹 Cleaning up Agora client...');
      isComponentMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopHeartbeat();
      agoraClient.removeAllListeners();
      if (remoteAudioTrack) {
        remoteAudioTrack.stop();
      }
      agoraClient.leave().catch(console.error);
    };
  }, [AgoraRTC, isSDKLoading, isMuted, volume]);

  // 🚨 CRITICAL: Enhanced heartbeat monitoring
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) return;

    console.log('💓 Starting enhanced heartbeat monitoring...');
    heartbeatIntervalRef.current = setInterval(checkBroadcasterStatus, heartbeatInterval);
  }, [checkBroadcasterStatus, heartbeatInterval]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
      console.log('💓 Heartbeat monitoring stopped');
    }
  }, []);

  // 🚨 CRITICAL: Session ID generation
  useEffect(() => {
    const generateSessionId = () => {
      try {
        let id = sessionStorage?.getItem('listener-session-id');
        if (!id) {
          id = `listener-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          sessionStorage?.setItem('listener-session-id', id);
        }
        setSessionId(id);
      } catch {
        setSessionId(`listener-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
      }
    };

    generateSessionId();
  }, []);

  // 🚨 CRITICAL: Volume handling
  const debouncedVolumeChange = useCallback(
    debounce((newVolume, audioTrack, muted) => {
      if (audioTrack && !muted) {
        try {
          audioTrack.setVolume(newVolume);
        } catch (error) {
          console.error('Volume control error:', error);
        }
      }
    }, 100),
    []
  );

  const handleVolumeChange = useCallback((newVolume) => {
    setVolume(newVolume);
    if (!isMuted) {
      debouncedVolumeChange(newVolume, remoteAudioTrack, false);
    }
  }, [remoteAudioTrack, isMuted, debouncedVolumeChange]);

  const handlePlayPauseStream = useCallback(async () => {
    if (!remoteAudioTrack) {
      setConnectionError('No audio stream available');
      toast.error('No audio stream available. Please check connection.');
      return;
    }
    
    try {
      if (isPlaying) {
        await remoteAudioTrack.stop();
        setIsPlaying(false);
        setWasPlayingBeforeDisconnect(false);
        toast.info("Stream paused", { id: 'stream-pause' });
      } else {
        await remoteAudioTrack.play();
        setIsPlaying(true);
        setWasPlayingBeforeDisconnect(true);
        setConnectionError(null);
        toast.success("Playing stream", { id: 'stream-play' });
      }
    } catch (error) {
      console.error('Playback error:', error);
      setConnectionError(`Playback error: ${error.message}`);
      toast.error("Failed to toggle playback", { id: 'playback-error' });
    }
  }, [remoteAudioTrack, isPlaying]);

  const toggleMute = useCallback(() => {
    if (!remoteAudioTrack) return;
    
    try {
      const newMutedState = !isMuted;
      if (newMutedState) {
        remoteAudioTrack.setVolume(0);
        toast.info("Audio muted", { id: 'audio-mute' });
      } else {
        remoteAudioTrack.setVolume(volume);
        toast.info("Audio unmuted", { id: 'audio-unmute' });
      }
      setIsMuted(newMutedState);
    } catch (error) {
      console.error('Mute error:', error);
      setConnectionError(`Mute error: ${error.message}`);
    }
  }, [remoteAudioTrack, isMuted, volume]);

  // 🚨 CRITICAL: Enhanced page visibility handling
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('📱 Page became visible - checking connection...');
        
        if (isLive && remoteAudioTrack && wasPlayingBeforeDisconnect && !isPlaying) {
          setTimeout(() => {
            handlePlayPauseStream();
          }, 500);
        }
        
        if (isConnected) {
          startHeartbeat();
        } else {
          // Force reconnection check when page becomes visible
          checkBroadcasterStatus();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isLive, remoteAudioTrack, wasPlayingBeforeDisconnect, isPlaying, isConnected, startHeartbeat, checkBroadcasterStatus]);

  // 🚨 CRITICAL: Audio context handling
  useEffect(() => {
    const resumeAudioContext = async () => {
      try {
        if (window.AudioContext || window.webkitAudioContext) {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('🔊 Audio context resumed');
          }
        }
      } catch (error) {
        console.error('Audio context error:', error);
      }
    };

    const handleUserInteraction = () => {
      resumeAudioContext();
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
    };

    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('touchstart', handleUserInteraction);

    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
    };
  }, []);

  // 🚨 CRITICAL: Cleanup
  useEffect(() => {
    return () => {
      debouncedVolumeChange.cancel();
      stopHeartbeat();
    };
  }, [debouncedVolumeChange, stopHeartbeat]);

  // 🚨 CRITICAL: Error state display
  if (sdkError) {
    return (
      <div className="min-h-screen bg-zero-beige flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-600" />
          <h2 className="text-xl font-inter font-semibold text-zero-text mb-2">
            Service Unavailable
          </h2>
          <p className="text-zero-text/70 font-inter mb-6">
            Failed to load interpretation service: {sdkError}
          </p>
          <div className="space-y-3">
            <Button
              onClick={() => window.location.reload()}
              className="w-full bg-zero-blue text-white hover:bg-zero-blue/90 font-inter font-semibold"
            >
              Refresh Page
            </Button>
            <p className="text-xs text-gray-600">
              If the problem persists, try Chrome, Firefox, or Safari
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 🚨 CRITICAL: Determine current status for UI
  const getStreamStatus = () => {
    if (isSDKLoading) return { status: 'loading', message: 'Loading audio system...' };
    if (connectionError) return { status: 'error', message: connectionError };
    if (isReconnecting) return { status: 'reconnecting', message: `Reconnecting... (${reconnectCount}/${maxReconnectAttempts})` };
    if (!isConnected) return { status: 'disconnected', message: 'Connecting to service...' };
    if (broadcasterOnline && !isLive) return { status: 'waiting', message: 'Broadcaster online, establishing audio...' };
    if (isLive) return { status: 'live', message: 'Live stream active' };
    return { status: 'offline', message: 'Waiting for broadcaster...' };
  };

  const streamStatus = getStreamStatus();

  return (
    <>
      <div className="min-h-screen bg-zero-beige">
        {/* Festival Header - loads immediately */}
        <div className="w-full overflow-hidden">
          <div className="w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw]">
            <img 
              src="/images/festival-poster.jpg" 
              alt="Green & Blue Festival - Ripartiamo da Zero - I Numeri per il Futuro del Pianeta"
              className="w-full h-auto object-cover"
              loading="eager"
              width="800"
              height="400"
              decoding="async"
            />
          </div>
        </div>

        <main className="w-full px-4 py-6 sm:px-6 sm:py-8">
          {/* Service Title */}
          <div className="text-center mb-10 sm:mb-12">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-inter font-bold text-zero-text mb-6">
              Live English Interpretation Service
            </h1>
            
            {/* Status Indicators */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
              {isSDKLoading ? (
                <>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-blue-600 bg-blue-50">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    Initializing Service
                  </div>
                  <div className="w-20 h-8 bg-gray-200 rounded-full animate-pulse"></div>
                  <div className="w-16 h-8 bg-gray-200 rounded-full animate-pulse"></div>
                </>
              ) : (
                <>
                  <Suspense fallback={<div className="w-16 h-8 bg-gray-200 rounded-full animate-pulse"></div>}>
                    <OnAirIndicator isLive={isLive} />
                  </Suspense>
                  <Suspense fallback={<div className="w-20 h-8 bg-gray-200 rounded-full animate-pulse"></div>}>
                    <ListenerCountBadge count={listenerCount} />
                  </Suspense>
                  
                  {/* Connection Status */}
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
                    streamStatus.status === 'live' ? 'text-green-600 bg-green-50' :
                    streamStatus.status === 'reconnecting' ? 'text-blue-600 bg-blue-50' :
                    streamStatus.status === 'error' ? 'text-red-600 bg-red-50' :
                    streamStatus.status === 'loading' ? 'text-blue-600 bg-blue-50' :
                    'text-orange-600 bg-orange-50'
                  }`}>
                    {streamStatus.status === 'reconnecting' || streamStatus.status === 'loading' ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    ) : streamStatus.status === 'live' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {streamStatus.status === 'live' ? 'Connected' :
                     streamStatus.status === 'reconnecting' ? `Reconnecting (${reconnectCount}/${maxReconnectAttempts})` :
                     streamStatus.status === 'error' ? 'Error' :
                     streamStatus.status === 'loading' ? 'Loading' :
                     streamStatus.status === 'waiting' ? 'Connecting Audio' :
                     'Offline'}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Alert Banners */}
          {streamStatus.status === 'reconnecting' && (
            <div className="max-w-md lg:max-w-4xl mx-auto mb-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <div>
                  <p className="font-semibold text-blue-800">
                    Reconnecting to interpretation service...
                  </p>
                  <p className="text-sm text-blue-600">
                    Attempt {reconnectCount} of {maxReconnectAttempts} - Audio will resume automatically
                  </p>
                </div>
              </div>
            </div>
          )}

          {streamStatus.status === 'error' && (
            <div className="max-w-md lg:max-w-4xl mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <div>
                  <p className="font-semibold text-red-800">Connection Issue</p>
                  <p className="text-sm text-red-600">{streamStatus.message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Main Player Section */}
          <div className="max-w-md lg:max-w-4xl mx-auto">
            <div className="lg:grid lg:grid-cols-2 lg:gap-10 space-y-8 lg:space-y-0">
              
              {/* Left Column - Primary Controls */}
              <div className="space-y-8">
                
                {/* Primary Control Card */}
                <Card className="bg-white/90 border-0 rounded-2xl">
                  <div className="p-8 text-center">
                    <div className="w-24 h-24 lg:w-32 lg:h-32 bg-gradient-to-br from-zero-green to-zero-blue rounded-full mx-auto mb-8 flex items-center justify-center transform transition-all duration-300 hover:scale-105">
                      {isPlaying ? (
                        <Pause className="h-10 w-10 lg:h-14 lg:w-14 text-white" />
                      ) : (
                        <Play className="h-10 w-10 lg:h-14 lg:w-14 text-white ml-1" />
                      )}
                    </div>
                    
                    <h3 className="text-2xl lg:text-3xl font-inter font-bold text-zero-text mb-4">
                      {streamStatus.status === 'live' ? 'Live Stream Active' : 
                       streamStatus.status === 'loading' ? 'Loading Service' :
                       streamStatus.status === 'error' ? 'Connection Error' :
                       streamStatus.status === 'reconnecting' ? 'Reconnecting' :
                       streamStatus.status === 'waiting' ? 'Connecting Audio' :
                       'Stream Offline'}
                    </h3>
                    
                    <p className="text-base lg:text-lg font-inter text-zero-text/70 mb-8">
                      {streamStatus.message}
                    </p>

                    {/* Action Buttons */}
                    {streamStatus.status === 'live' && (
                      <Button 
                        onClick={handlePlayPauseStream}
                        className={`w-full text-lg lg:text-xl px-8 py-6 lg:py-8 font-bold transition-all duration-300 hover:scale-105 font-inter rounded-xl ${
                          isPlaying 
                            ? 'bg-zero-warning text-white hover:bg-zero-warning/90' 
                            : 'bg-zero-green text-zero-text hover:bg-zero-green/90'
                        }`}
                        size="lg"
                        disabled={streamStatus.status === 'reconnecting'}
                      >
                        {isPlaying ? (
                          <>
                            <Pause className="mr-2 h-5 w-5 lg:h-6 lg:w-6" />
                            Pause Stream
                          </>
                        ) : (
                          <>
                            <Play className="mr-2 h-5 w-5 lg:h-6 lg:w-6" />
                            Start Listening
                          </>
                        )}
                      </Button>
                    )}

                    {streamStatus.status !== 'live' && (
                      <Button
                        className="w-full text-lg lg:text-xl px-8 py-6 lg:py-8 bg-zero-navy/80 text-white font-bold font-inter rounded-xl"
                        size="lg"
                        disabled
                      >
                        <Radio className="mr-2 h-5 w-5 lg:h-6 lg:w-6" />
                        {streamStatus.status === 'loading' ? 'Loading Audio System...' : 
                         streamStatus.status === 'reconnecting' ? 'Reconnecting...' :
                         streamStatus.status === 'error' ? 'Connection Failed' :
                         streamStatus.status === 'waiting' ? 'Establishing Audio...' :
                         'Waiting For Broadcaster...'}
                      </Button>
                    )}

                    {/* Error Recovery Actions */}
                    {(streamStatus.status === 'error' || reconnectCount >= maxReconnectAttempts) && (
                      <div className="mt-4 space-y-2">
                        <Button
                          onClick={() => window.location.reload()}
                          className="w-full bg-red-600 text-white hover:bg-red-700 font-inter font-semibold py-3 rounded-xl"
                        >
                          Refresh Page
                        </Button>
                        <p className="text-xs text-red-600">
                          If the problem persists, try switching to a different browser or network
                        </p>
                      </div>
                    )}

                    {/* Debug Info (only shown during issues) */}
                    {(streamStatus.status === 'error' || streamStatus.status === 'waiting') && (
                      <div className="mt-4 p-3 bg-gray-50 rounded text-xs text-left">
                        <div className="font-semibold mb-1">Debug Info:</div>
                        <div>SDK: {isSDKLoading ? 'Loading' : 'Ready'}</div>
                        <div>Connected: {isConnected ? 'Yes' : 'No'}</div>
                        <div>Broadcaster Online: {broadcasterOnline ? 'Yes' : 'No'}</div>
                        <div>Audio Track: {remoteAudioTrack ? 'Available' : 'None'}</div>
                        <div>Reconnect Attempts: {reconnectCount}/{maxReconnectAttempts}</div>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Audio Controls */}
                <Card className="bg-white/90 border-0 rounded-2xl">
                  <div className="p-8">
                    <h4 className="text-xl lg:text-2xl font-inter font-bold text-zero-text mb-8 flex items-center gap-3">
                      <Volume className="h-6 w-6 lg:h-7 lg:w-7 text-zero-blue" />
                      Audio Controls
                    </h4>
                    
                    <div className="flex items-center gap-6">
                      <button
                        onClick={toggleMute}
                        className="p-4 lg:p-5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-all duration-300 group"
                        disabled={!isConnected || streamStatus.status === 'reconnecting' || isSDKLoading}
                      >
                        {isMuted ? (
                          <VolumeX className="h-6 w-6 lg:h-7 lg:w-7 text-zero-warning" />
                        ) : (
                          <Volume className="h-6 w-6 lg:h-7 lg:w-7 text-zero-text group-hover:text-zero-blue transition-colors" />
                        )}
                      </button>
                      
                      <div className="flex-1 space-y-3">
                        {!isIOS ? (
                          <>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step={1}
                              value={isMuted ? 0 : volume}
                              onChange={(e) => handleVolumeChange(Number(e.target.value))}
                              disabled={isMuted || !isConnected || streamStatus.status === 'reconnecting' || isSDKLoading}
                              className="w-full h-3 lg:h-4 bg-gray-200 rounded-full appearance-none cursor-pointer slider"
                            />
                            <div className="flex justify-between text-sm lg:text-base text-zero-text/70 font-inter font-medium">
                              <span>0%</span>
                              <span className="font-bold text-zero-text">{isMuted ? 'Muted' : `${volume}%`}</span>
                              <span>100%</span>
                            </div>
                          </>
                        ) : (
                          <div className="text-center py-4">
                            <p className="text-sm text-zero-text/70 font-inter">
                              Please use your device's volume buttons to adjust audio level
                            </p>
                            <div className="mt-2 text-lg font-bold text-zero-text">
                              {isMuted ? 'Muted' : 'Volume: Use Device Controls'}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Right Column - Audio Level */}
              <div className="space-y-8">
                
                {/* Audio Level Display */}
                <Card className="bg-white/90 border-0 rounded-2xl">
                  <div className="p-8">
                    <h4 className="text-xl lg:text-2xl font-inter font-bold text-zero-text mb-8 flex items-center gap-2">
                      <Signal className="h-5 w-5 lg:h-6 lg:w-6 text-zero-green" />
                      Audio Level
                    </h4>
                    
                    {isSDKLoading ? (
                      <div className="mb-4">
                        <div className="h-32 bg-gray-100 rounded-lg animate-pulse flex items-center justify-center">
                          <div className="text-center">
                            <div className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                            <p className="text-sm text-gray-500">Loading audio meter...</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Suspense fallback={
                        <div className="mb-4">
                          <div className="h-32 bg-gray-100 rounded-lg animate-pulse"></div>
                        </div>
                      }>
                        <AudioLevelMeter
                          level={audioLevel}
                          isActive={isConnected && isLive && isPlaying && streamStatus.status !== 'reconnecting'}
                          className="mb-4"
                          mediaStreamTrack={remoteMediaStreamTrack}
                        />
                      </Suspense>
                    )}

                    <div className="text-center">
                      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
                        streamStatus.status === 'live' && isPlaying
                          ? 'bg-zero-status-good/10 text-zero-status-good' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          streamStatus.status === 'live' && isPlaying
                            ? 'bg-zero-status-good animate-pulse' 
                            : 'bg-gray-400'
                        }`}></div>
                        {streamStatus.status === 'live' && isPlaying ? 'Audio Active' : 
                         streamStatus.status === 'error' ? 'Connection Error' :
                         streamStatus.status === 'loading' ? 'Initializing' : 
                         streamStatus.status === 'reconnecting' ? 'Reconnecting' :
                         'Audio Inactive'}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Connection Status Details */}
                <Card className="bg-white/90 border-0 rounded-2xl">
                  <div className="p-8">
                    <h4 className="text-xl lg:text-2xl font-inter font-bold text-zero-text mb-6">
                      Connection Status
                    </h4>
                    
                    <div className="space-y-4 text-sm">
                      <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium text-zero-text/70">Service Status</span>
                        <span className={`font-bold ${
                          streamStatus.status === 'live' ? 'text-green-600' :
                          streamStatus.status === 'error' ? 'text-red-600' :
                          streamStatus.status === 'reconnecting' ? 'text-blue-600' :
                          'text-orange-600'
                        }`}>
                          {streamStatus.status === 'live' ? 'Connected' :
                           streamStatus.status === 'error' ? 'Error' :
                           streamStatus.status === 'reconnecting' ? 'Reconnecting' :
                           streamStatus.status === 'loading' ? 'Loading' :
                           'Connecting'}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium text-zero-text/70">Broadcaster</span>
                        <span className={`font-bold ${broadcasterOnline ? 'text-green-600' : 'text-gray-600'}`}>
                          {broadcasterOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium text-zero-text/70">Audio Stream</span>
                        <span className={`font-bold ${isLive ? 'text-green-600' : 'text-gray-600'}`}>
                          {isLive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium text-zero-text/70">Listeners</span>
                        <span className="font-bold text-zero-text">{listenerCount}</span>
                      </div>

                      {reconnectCount > 0 && (
                        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                          <span className="font-medium text-blue-700">Reconnect Attempts</span>
                          <span className="font-bold text-blue-800">{reconnectCount}/{maxReconnectAttempts}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Contact Us Button */}
                <div className="text-center">
                  <Button 
                    className="bg-zero-blue text-white hover:bg-zero-blue/90 font-inter font-semibold px-8 py-4 rounded-xl transition-all duration-300 hover:scale-105"
                    onClick={() => setShowContactModal(true)}
                  >
                    Contact Us
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Service Title */}
        <div className="text-center py-8 px-4">
          <p className="text-lg font-inter font-semibold text-zero-text">
            Green&Blue Festival • Live English Interpretation Service
          </p>
        </div>

        {/* Footer */}
        <div className="w-full overflow-hidden">
          <div className="w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw]">
            <img 
              src="/images/layout.png" 
              alt="Festival Layout and Sponsors Information"
              className="w-full h-auto object-cover"
              loading="lazy"
              width="1000"
              height="400"
              decoding="async"
            />
          </div>
        </div>
      </div>

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-sm sm:max-w-md w-full mx-2 sm:mx-4 transform transition-all duration-300 scale-100 max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-8">
              <div className="text-center mb-4 sm:mb-6">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-zero-green to-zero-blue rounded-full mx-auto mb-3 sm:mb-4 flex items-center justify-center">
                  <svg className="w-6 h-6 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl sm:text-2xl font-inter font-bold text-zero-text mb-2">Contact Support</h3>
                <p className="text-sm sm:text-base text-zero-text/70 font-inter">Get help with the Live English Interpretation Service</p>
              </div>

              <div className="bg-gray-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
                <div className="text-center">
                  <p className="text-xs sm:text-sm text-zero-text/70 font-inter mb-2">Email us at:</p>
                  <p className="text-base sm:text-lg font-inter font-bold text-zero-text mb-3 sm:mb-4">info@rafiky.net</p>
                  <p className="text-xs sm:text-sm text-zero-text/60 font-inter leading-relaxed">
                    We'll respond to your inquiry as soon as possible. Click below to open your email client.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => {
                    window.location.href = "mailto:info@rafiky.net?subject=Green&Blue Festival - Live English Interpretation Support&body=Hello,%0D%0A%0D%0AI need assistance with the Live English Interpretation Service.%0D%0A%0D%0APlease describe your issue:%0D%0A";
                    setShowContactModal(false);
                  }}
                  className="w-full bg-gradient-to-r from-zero-green to-zero-blue text-white hover:from-zero-green/90 hover:to-zero-blue/90 font-inter font-semibold py-3 sm:py-4 rounded-xl transition-all duration-300 text-sm sm:text-base"
                >
                  Send Email
                </Button>
                <Button
                  onClick={() => setShowContactModal(false)}
                  className="w-full bg-gray-100 text-zero-text hover:bg-gray-200 font-inter font-semibold py-3 sm:py-4 rounded-xl transition-all duration-300 text-sm sm:text-base"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Optimized CSS */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #A6B92B, #4A90E2);
          cursor: pointer;
          border: 2px solid white;
          transition: transform 0.2s ease;
        }
        
        @media (min-width: 1024px) {
          .slider::-webkit-slider-thumb {
            height: 24px;
            width: 24px;
          }
        }
        
        .slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
        
        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #A6B92B, #4A90E2);
          cursor: pointer;
          border: 2px solid white;
        }

        .slider {
          background: linear-gradient(to right, #A6B92B 0%, #A6B92B ${volume}%, #e5e7eb ${volume}%, #e5e7eb 100%) !important;
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }
        
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .5; }
        }
      `}</style>
    </>
  );
};

export default React.memo(Listner);