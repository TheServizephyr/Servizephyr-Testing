
import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const CustomAudioPlayer = ({ src, fileName, className }) => {
    const audioRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const setAudioData = () => {
            setDuration(audio.duration);
            setLoading(false);
        };

        const setAudioTime = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

        const handleError = () => {
            setError(true);
            setLoading(false);
        };

        // Events
        audio.addEventListener('loadedmetadata', setAudioData);
        audio.addEventListener('timeupdate', setAudioTime);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('error', handleError);

        // Check if metadata is already loaded (for cached audio)
        if (audio.readyState >= 1) {
            setAudioData();
        }

        return () => {
            audio.removeEventListener('loadedmetadata', setAudioData);
            audio.removeEventListener('timeupdate', setAudioTime);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
        };
    }, []);

    const togglePlay = () => {
        if (!audioRef.current || error) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleSeek = (value) => {
        if (!audioRef.current) return;
        audioRef.current.currentTime = value[0];
        setCurrentTime(value[0]);
    };

    if (error) {
        return (
            <div className={cn("flex items-center gap-2 p-2 bg-red-50 text-red-600 rounded-lg text-xs", className)}>
                <AlertCircle size={16} />
                <span>Failed to load audio</span>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col gap-2 w-full max-w-xs bg-muted/30 p-3 rounded-xl border border-border/50 backdrop-blur-sm", className)}>
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-primary bg-primary/10 hover:bg-primary/20 rounded-full shrink-0 transition-all hover:scale-105"
                    onClick={togglePlay}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 size={20} className="animate-spin" />
                    ) : isPlaying ? (
                        <Pause size={20} fill="currentColor" />
                    ) : (
                        <Play size={20} fill="currentColor" className="ml-1" />
                    )}
                </Button>

                <div className="flex flex-col flex-1 min-w-0 gap-1">
                    <span className="text-sm font-medium truncate text-foreground/90">
                        {fileName || 'Voice Message'}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                </div>
            </div>

            <div className="px-1">
                <Slider
                    value={[currentTime]}
                    max={duration || 100}
                    step={0.1}
                    onValueChange={handleSeek}
                    className="cursor-pointer"
                />
            </div>

            <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
        </div>
    );
};

export default CustomAudioPlayer;
