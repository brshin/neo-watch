import { useState, useEffect, useRef } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { useAuth } from "@clerk/clerk-react";
import AsteroidMark, { variantFromName } from './AsteroidMark.jsx';

const API_BASE_URL = import.meta.env.VITE_API_URL;
const GUEST_SESSION_KEY = 'neowatch-guest';
const LOCAL_VAULT_KEY = 'neowatch-guest-vault';

function readGuestFlag() {
    try {
        return sessionStorage.getItem(GUEST_SESSION_KEY) === '1';
    } catch {
        return false;
    }
}

function writeGuestFlag(enabled) {
    try {
        if (enabled) {
            sessionStorage.setItem(GUEST_SESSION_KEY, '1');
        } else {
            sessionStorage.removeItem(GUEST_SESSION_KEY);
        }
    } catch {
        // sessionStorage may be unavailable; in-memory state still works for the session
    }
}

function readLocalVault() {
    try {
        const raw = localStorage.getItem(LOCAL_VAULT_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLocalVault(favorites) {
    try {
        localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(favorites));
    } catch {
        // localStorage may be unavailable
    }
}

function clearLocalVault() {
    try {
        localStorage.removeItem(LOCAL_VAULT_KEY);
    } catch {
        // localStorage may be unavailable
    }
}

function scaleFromDiameter(meters, maxMeters) {
    if (!meters || !maxMeters) {
        return 1;
    }
    return 0.72 + (meters / maxMeters) * 0.58;
}

function formatDiameter(meters) {
    if (meters == null || Number.isNaN(Number(meters))) {
        return null;
    }
    return `${Math.round(Number(meters)).toLocaleString('en-US')} m`;
}

function formatDiameterRange(minMeters, maxMeters) {
    const maxLabel = formatDiameter(maxMeters);
    if (!maxLabel) {
        return null;
    }
    const minLabel = formatDiameter(minMeters);
    if (!minLabel || Number(minMeters) === Number(maxMeters)) {
        return maxLabel;
    }
    return `${minLabel} – ${maxLabel}`;
}

function formatMissDistance(km) {
    const value = Number(km);
    if (!Number.isFinite(value)) {
        return null;
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(2)}M km`;
    }
    if (value >= 1_000) {
        return `${Math.round(value / 1_000).toLocaleString('en-US')}k km`;
    }
    return `${Math.round(value).toLocaleString('en-US')} km`;
}

function formatVelocity(kps) {
    const value = Number(kps);
    if (!Number.isFinite(value)) {
        return null;
    }
    return `${value.toFixed(1)} km/s`;
}

function formatMagnitude(magnitude) {
    const value = Number(magnitude);
    if (!Number.isFinite(value)) {
        return null;
    }
    return `H ${value.toFixed(1)}`;
}

function favoritePayload(asteroid) {
    return {
        id: asteroid.id || asteroid.neoId || null,
        name: asteroid.name,
        potentiallyHazardous: asteroid.potentiallyHazardous,
        estimatedDiameter: asteroid.estimatedDiameter ?? null,
        estimatedDiameterMin: asteroid.estimatedDiameterMin ?? null,
        absoluteMagnitudeH: asteroid.absoluteMagnitudeH ?? null,
        nasaJplUrl: asteroid.nasaJplUrl || null,
        closeApproachDate: asteroid.closeApproachDate || null,
        missDistanceKm: asteroid.missDistanceKm ?? null,
        relativeVelocityKps: asteroid.relativeVelocityKps ?? null,
        isSentryObject: Boolean(asteroid.isSentryObject),
    };
}

function formatApproachDate(raw) {
    if (!raw) {
        return null;
    }
    // NASA feed uses values like "2026-Nov-03 07:03"
    return String(raw).replace(/^\d{4}-/, '').replace('-', ' ');
}

function asteroidMetrics(asteroid) {
    return [
        {
            label: 'Approach',
            value: formatApproachDate(asteroid.closeApproachDate),
        },
        {
            label: 'Miss',
            value: formatMissDistance(asteroid.missDistanceKm),
        },
        {
            label: 'Velocity',
            value: formatVelocity(asteroid.relativeVelocityKps),
        },
        {
            label: 'Magnitude',
            value: formatMagnitude(asteroid.absoluteMagnitudeH),
        },
    ].filter((metric) => Boolean(metric.value));
}

function MetricStrip({ metrics }) {
    if (!metrics.length) {
        return null;
    }

    return (
        <dl className="metric-strip grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((metric) => (
                <div key={metric.label} className="metric-cell min-w-0">
                    <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-soft">
                        {metric.label}
                    </dt>
                    <dd className="mt-0.5 truncate font-display text-[0.95rem] font-bold leading-tight tracking-tight text-ink tabular-nums sm:text-base">
                        {metric.value}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

async function syncLocalVaultToServer(token) {
    const localFavorites = readLocalVault();
    if (localFavorites.length === 0) {
        return 0;
    }

    let synced = 0;

    for (const item of localFavorites) {
        try {
            const postRes = await fetch(`${API_BASE_URL}/asteroids/favorites`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(favoritePayload(item)),
            });

            if (postRes.ok) {
                synced += 1;
            }

            if (item.note) {
                await fetch(`${API_BASE_URL}/asteroids/favorites/${encodeURIComponent(item.name)}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ note: item.note }),
                });
            }
        } catch (err) {
            console.error('Failed to sync local favorite:', item.name, err);
        }
    }

    clearLocalVault();
    return synced;
}

function App() {
    const [asteroids, setAsteroids] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [toast, setToast] = useState(null);
    const [editingName, setEditingName] = useState(null);
    const [draftNote, setDraftNote] = useState('');
    const [isGuest, setIsGuest] = useState(readGuestFlag);
    const [leavingNames, setLeavingNames] = useState(() => new Set());
    const toastTimer = useRef(null);
    const syncAttempted = useRef(false);
    const leaveTimers = useRef(new Map());

    const { getToken, isLoaded, isSignedIn } = useAuth();
    const canBrowse = isSignedIn || isGuest;

    const showToast = (message) => {
        setToast(message);
        if (toastTimer.current) {
            clearTimeout(toastTimer.current);
        }
        toastTimer.current = setTimeout(() => setToast(null), 4000);
    };

    const enterAsGuest = () => {
        writeGuestFlag(true);
        setIsGuest(true);
    };

    const exitGuest = () => {
        writeGuestFlag(false);
        setIsGuest(false);
        setAsteroids([]);
        setFavorites([]);
        setEditingName(null);
        setDraftNote('');
        setLeavingNames(new Set());
        setIsLoading(false);
    };

    useEffect(() => {
        const timers = leaveTimers.current;
        return () => {
            timers.forEach((timerId) => clearTimeout(timerId));
            timers.clear();
        };
    }, []);

    useEffect(() => {
        if (isSignedIn && isGuest) {
            writeGuestFlag(false);
            setIsGuest(false);
        }
    }, [isSignedIn, isGuest]);

    useEffect(() => {
        if (!isLoaded) {
            return;
        }

        if (!isSignedIn && !isGuest) {
            setAsteroids([]);
            setFavorites([]);
            setIsLoading(false);
            syncAttempted.current = false;
            return;
        }

        const fetchAllData = async () => {
            setIsLoading(true);

            try {
                if (isSignedIn) {
                    const token = await getToken();

                    if (!syncAttempted.current) {
                        syncAttempted.current = true;
                        const syncedCount = await syncLocalVaultToServer(token);
                        if (syncedCount > 0) {
                            showToast(`Synced ${syncedCount} local favorite${syncedCount === 1 ? '' : 's'} to your vault.`);
                        }
                    }

                    const [asteroidsRes, favoritesRes] = await Promise.all([
                        fetch(`${API_BASE_URL}/asteroids`),
                        fetch(`${API_BASE_URL}/asteroids/favorites`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        })
                    ]);

                    if (asteroidsRes.ok) {
                        const asteroidsData = await asteroidsRes.json();
                        console.log("Data from backend (asteroids):", asteroidsData);
                        setAsteroids(asteroidsData);
                    }

                    if (favoritesRes.ok) {
                        const favoritesData = await favoritesRes.json();
                        console.log("Data from backend (favorites):", favoritesData);
                        setFavorites(favoritesData);
                    }
                } else {
                    const asteroidsRes = await fetch(`${API_BASE_URL}/asteroids`);

                    if (asteroidsRes.ok) {
                        const asteroidsData = await asteroidsRes.json();
                        console.log("Data from backend (asteroids):", asteroidsData);
                        setAsteroids(asteroidsData);
                    }

                    setFavorites(readLocalVault());
                }
            }
            catch (err) {
                console.error("Error fetching all data:", err);
                showToast(err.message);
            }
            finally {
                setIsLoading(false);
            }
        };

        fetchAllData();
    }, [isLoaded, isSignedIn, isGuest, getToken]);

    const handleSaveAsteroid = async (asteroid) => {
        if (!isSignedIn) {
            setFavorites((prevFavorites) => {
                if (prevFavorites.some((item) => item.name === asteroid.name)) {
                    return prevFavorites;
                }

                const next = [
                    ...prevFavorites,
                    {
                        ...favoritePayload(asteroid),
                        note: '',
                    },
                ];
                writeLocalVault(next);
                return next;
            });
            showToast('Saved on this device. Sign in to sync your vault.');
            return;
        }

        const token = await getToken();
        console.log(token);

        fetch(`${API_BASE_URL}/asteroids/favorites`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(favoritePayload(asteroid))
        })
        .then(async (res) => {
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message);
            }

            return data;
        })
        .then((saved) => {
            console.log("Success! Server says: ", saved);
            setFavorites((prevFavorites) => [...prevFavorites, saved]);
        })
        .catch(err => {
            console.error("Failed to add:", err);
            showToast(err.message);
        });
    };

    const removeFavoriteNow = async (asteroidName) => {
        if (!isSignedIn) {
            setFavorites((prevFavorites) => {
                const next = prevFavorites.filter((ast) => ast.name !== asteroidName);
                writeLocalVault(next);
                return next;
            });
            if (editingName === asteroidName) {
                setEditingName(null);
                setDraftNote('');
            }
            return;
        }

        const token = await getToken();

        try {
            const res = await fetch(`${API_BASE_URL}/asteroids/favorites/${asteroidName}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || "Failed to delete asteroid");
            }

            console.log("Success! Server says:", data.message);
            setFavorites((favorites) => favorites.filter((ast) => ast.name !== asteroidName));
            if (editingName === asteroidName) {
                setEditingName(null);
                setDraftNote('');
            }
        } catch (err) {
            console.error("Error removing:", err.message);
            showToast(err.message);
            setLeavingNames((prev) => {
                const next = new Set(prev);
                next.delete(asteroidName);
                return next;
            });
        }
    };

    const handleRemoveAsteroid = (asteroidName) => {
        if (leavingNames.has(asteroidName)) {
            return;
        }

        setLeavingNames((prev) => new Set(prev).add(asteroidName));

        const existing = leaveTimers.current.get(asteroidName);
        if (existing) {
            clearTimeout(existing);
        }

        const timerId = setTimeout(() => {
            leaveTimers.current.delete(asteroidName);
            removeFavoriteNow(asteroidName);
            setLeavingNames((prev) => {
                const next = new Set(prev);
                next.delete(asteroidName);
                return next;
            });
        }, 280);

        leaveTimers.current.set(asteroidName, timerId);
    };

    const handleUpdateNote = async (asteroidName, newNote) => {
        if (!isSignedIn) {
            setFavorites((prevFavorites) => {
                const next = prevFavorites.map((ast) =>
                    ast.name === asteroidName ? { ...ast, note: newNote } : ast
                );
                writeLocalVault(next);
                return next;
            });
            setEditingName(null);
            setDraftNote('');
            showToast('Note saved on this device.');
            return;
        }

        const token = await getToken();

        fetch(`${API_BASE_URL}/asteroids/favorites/${asteroidName}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
            body: JSON.stringify({ note: newNote })
        })
        .then(async (res) => {
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || "Could not save your note");
            }
            return data;
        })
        .then(updatedAsteroid => {
            console.log("Database updated successfully:", updatedAsteroid);

            setFavorites(prevFavorites => 
                prevFavorites.map(ast => 
                    ast.name === asteroidName ? updatedAsteroid : ast
                )
            );
            setEditingName(null);
            setDraftNote('');
        })
        .catch(err => {
            console.error("Update failed:", err.message);
            showToast(`Error saving note: ${err.message}`);
        });
    };

    const maxDiameter = asteroids.reduce(
        (max, asteroid) => Math.max(max, Number(asteroid.estimatedDiameter) || 0),
        0
    );
    const favoriteNames = new Set(favorites.map((asteroid) => asteroid.name));
    const todayLabel = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return (
        <div className="min-h-screen font-sans text-ink">
            <header className="relative z-10 flex items-center justify-between px-5 py-4 md:px-10">
                {isGuest ? (
                    <button
                        type="button"
                        onClick={exitGuest}
                        className="font-display text-sm font-bold tracking-[0.18em] uppercase text-ink transition-colors hover:text-signal md:text-base"
                        aria-label="Back to welcome"
                    >
                        NeoWatch
                    </button>
                ) : (
                    <p className="font-display text-sm font-bold tracking-[0.18em] uppercase text-ink md:text-base">
                        NeoWatch
                    </p>
                )}

                <div className="flex items-center gap-3">
                    <SignedOut>
                        {isGuest && (
                            <button
                                type="button"
                                onClick={exitGuest}
                                className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:text-signal"
                            >
                                Leave session
                            </button>
                        )}
                        <SignInButton mode="modal">
                            <button className="border border-ink/20 bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-signal hover:text-signal">
                                Sign in
                            </button>
                        </SignInButton>
                    </SignedOut>
                    <SignedIn>
                        <UserButton />
                    </SignedIn>
                </div>
            </header>

            {!canBrowse && (
                <section className="mx-auto grid min-h-[calc(100vh-4.5rem)] w-full max-w-6xl items-center gap-10 px-5 py-10 md:grid-cols-2 md:gap-8 md:px-10 md:py-12 lg:gap-14">
                    <div className="relative z-10 max-w-xl animate-fade-rise">
                        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.28em] text-signal">
                            Near-Earth catalog
                        </p>
                        <h1 className="font-display text-[clamp(2.5rem,6vw,4.75rem)] font-extrabold leading-[0.95] tracking-[-0.04em] text-ink">
                            Neo
                            <br />
                            Watch
                        </h1>
                        <p className="mt-5 max-w-md text-base leading-relaxed text-ink-soft md:mt-6">
                            Today&apos;s near-Earth objects from NASA NeoWs — browse as a guest, or sign in to keep a private watch list.
                        </p>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                            <button
                                type="button"
                                onClick={enterAsGuest}
                                className="bg-signal px-7 py-3.5 text-sm font-semibold tracking-wide text-signal-ink transition-opacity hover:opacity-90"
                            >
                                Continue as guest
                            </button>
                            <SignInButton mode="modal">
                                <button className="border border-ink/25 bg-transparent px-7 py-3.5 text-sm font-semibold tracking-wide text-ink transition-colors hover:border-ink">
                                    Sign in
                                </button>
                            </SignInButton>
                        </div>
                    </div>

                    <div
                        className="hero-stage relative mx-auto flex aspect-square w-full max-w-[18rem] items-center justify-center sm:max-w-[20rem] md:max-w-[22rem] lg:max-w-[26rem]"
                        aria-hidden="true"
                    >
                        <div className="hero-orbit absolute inset-0 animate-orbit">
                            <span className="hero-orbit-dot" />
                        </div>
                        <div className="sky-band absolute left-[12%] top-[48%] h-px w-[76%] bg-gradient-to-r from-transparent via-signal/60 to-transparent" />
                        <div className="hero-asteroid relative flex w-[58%] items-center justify-center">
                            <AsteroidMark size="100%" variant={2} />
                        </div>
                    </div>
                </section>
            )}

            {canBrowse && (
                <>
                {isLoading ? (
                    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-28 text-center animate-fade-rise">
                        <div className="relative mb-8 h-20 w-20" aria-hidden="true">
                            <div className="absolute inset-0 rounded-full border border-ink/15" />
                            <div className="absolute inset-0 animate-orbit">
                                <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal" />
                            </div>
                        </div>
                        <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Catalog coming online</h2>
                        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                            The archive is waking from idle. This can take up to 30 seconds.
                        </p>
                    </div>
                ) : (
                    <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-2 md:px-10">
                        <section className="animate-fade-rise">
                            <div className="mb-6 grid gap-4 border-b border-line pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <div>
                                    <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-signal">
                                        Live feed
                                    </p>
                                    <h2 className="font-display text-3xl font-bold tracking-tight text-ink md:text-4xl">
                                        Today&apos;s catalog
                                    </h2>
                                    <p className="mt-2 font-mono text-xs tracking-[0.04em] text-ink-soft">
                                        {todayLabel}
                                        <span className="mx-2 text-line">/</span>
                                        Source <span className="text-signal">NASA NeoWs</span>
                                    </p>
                                </div>
                                <div className="text-left md:text-right">
                                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                                        Objects
                                    </p>
                                    <p className="stat-num font-display text-5xl font-extrabold leading-none text-ink">
                                        {String(asteroids.length).padStart(2, '0')}
                                    </p>
                                </div>
                            </div>

                            <ul className="divide-y divide-line border-y border-line">
                                {asteroids.map((asteroid, index) => {
                                    const isFavorited = favoriteNames.has(asteroid.name);
                                    const scale = scaleFromDiameter(asteroid.estimatedDiameter, maxDiameter);
                                    const diameterLabel = formatDiameterRange(
                                        asteroid.estimatedDiameterMin,
                                        asteroid.estimatedDiameter
                                    );
                                    const variant = variantFromName(asteroid.name);
                                    const metrics = [
                                        ...asteroidMetrics(asteroid),
                                        diameterLabel
                                            ? { label: 'Diameter', value: diameterLabel }
                                            : null,
                                    ].filter(Boolean);

                                    return (
                                        <li
                                            key={asteroid.id || asteroid.name}
                                            className="catalog-row grid grid-cols-[2.25rem_3.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 px-1 py-4 animate-fade-rise sm:grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_auto]"
                                            style={{ animationDelay: `${index * 40}ms` }}
                                        >
                                            <p className="pt-1 font-mono text-[11px] tabular-nums text-ink-soft">
                                                {String(index + 1).padStart(2, '0')}
                                            </p>

                                            <div className="flex items-start justify-center pt-0.5">
                                                <AsteroidMark
                                                    size={`${2.35 * scale}rem`}
                                                    variant={variant}
                                                    hazardous={asteroid.potentiallyHazardous}
                                                />
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                                    <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                                                        {asteroid.name}
                                                    </h3>
                                                    <span
                                                        className={`font-mono text-[10px] font-medium uppercase tracking-[0.16em] ${
                                                            asteroid.potentiallyHazardous ? 'text-hazard' : 'text-safe'
                                                        }`}
                                                    >
                                                        {asteroid.potentiallyHazardous ? 'PHA' : 'Non-PHA'}
                                                    </span>
                                                    {asteroid.isSentryObject && (
                                                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-hazard">
                                                            Sentry
                                                        </span>
                                                    )}
                                                    {asteroid.nasaJplUrl && (
                                                        <a
                                                            href={asteroid.nasaJplUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal transition-opacity hover:opacity-70"
                                                        >
                                                            JPL ↗
                                                        </a>
                                                    )}
                                                </div>

                                                <MetricStrip metrics={metrics} />
                                            </div>

                                            <div className="col-span-3 sm:col-span-1 sm:justify-self-end sm:pt-0.5">
                                                <button
                                                    onClick={() => handleSaveAsteroid(asteroid)}
                                                    disabled={isFavorited}
                                                    className={`w-full px-3 py-2 text-sm font-semibold tracking-wide transition-colors sm:w-auto ${
                                                        isFavorited
                                                            ? 'cursor-not-allowed border border-line text-ink-soft'
                                                            : 'bg-ink text-panel hover:bg-signal hover:text-signal-ink'
                                                    }`}
                                                >
                                                    {isFavorited ? 'In vault' : 'Favorite'}
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>

                        <section className="mt-14 animate-fade-rise" style={{ animationDelay: '100ms' }}>
                            <div className="mb-5 grid gap-3 border-b border-line pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <div>
                                    <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-signal">
                                        Watch list
                                    </p>
                                    <h2 className="font-display text-3xl font-bold tracking-tight text-ink md:text-4xl">
                                        The vault
                                    </h2>
                                    <p className="mt-2 max-w-xl text-sm text-ink-soft">
                                        {isSignedIn
                                            ? 'Private watch list and commander\'s log synced to your account.'
                                            : 'Saved on this device · Sign in to sync across sessions.'}
                                    </p>
                                </div>
                                <div className="text-left md:text-right">
                                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                                        Stored
                                    </p>
                                    <p className="stat-num font-display text-4xl font-extrabold leading-none text-ink md:text-5xl">
                                        {String(favorites.length).padStart(2, '0')}
                                    </p>
                                </div>
                            </div>

                            {favorites.length === 0 ? (
                                <div className="border border-dashed border-line px-6 py-14 text-ink-soft">
                                    <p className="text-base">The vault is empty. Choose an object from today&apos;s catalog.</p>
                                    {!isSignedIn && (
                                        <div className="mt-6">
                                            <SignInButton mode="modal">
                                                <button className="border border-ink/20 bg-panel px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-signal hover:text-signal">
                                                    Sign in to sync later
                                                </button>
                                            </SignInButton>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <ul className="divide-y divide-line border-y border-line">
                                    {favorites.map((asteroid, index) => {
                                        const scale = scaleFromDiameter(asteroid.estimatedDiameter, maxDiameter);
                                        const diameterLabel = formatDiameterRange(
                                            asteroid.estimatedDiameterMin,
                                            asteroid.estimatedDiameter
                                        );
                                        const variant = variantFromName(asteroid.name);
                                        const isEditing = editingName === asteroid.name;
                                        const isLeaving = leavingNames.has(asteroid.name);
                                        const metrics = [
                                            ...asteroidMetrics(asteroid),
                                            diameterLabel
                                                ? { label: 'Diameter', value: diameterLabel }
                                                : null,
                                        ].filter(Boolean);

                                        return (
                                            <li
                                                key={asteroid.id || asteroid.neoId || asteroid.name}
                                                className={`catalog-row grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-1 py-4 md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] ${
                                                    isLeaving ? 'catalog-row-leave' : 'animate-fade-rise'
                                                }`}
                                                style={isLeaving ? undefined : { animationDelay: `${index * 40}ms` }}
                                            >
                                                <div className="flex items-start justify-center pt-0.5">
                                                    <AsteroidMark
                                                        size={`${2.35 * scale}rem`}
                                                        variant={variant}
                                                        hazardous={asteroid.potentiallyHazardous}
                                                    />
                                                </div>

                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                                        <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                                                            {asteroid.name}
                                                        </h3>
                                                        <span
                                                            className={`font-mono text-[10px] font-medium uppercase tracking-[0.16em] ${
                                                                asteroid.potentiallyHazardous ? 'text-hazard' : 'text-safe'
                                                            }`}
                                                        >
                                                            {asteroid.potentiallyHazardous ? 'PHA' : 'Non-PHA'}
                                                        </span>
                                                        {asteroid.nasaJplUrl && (
                                                            <a
                                                                href={asteroid.nasaJplUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal transition-opacity hover:opacity-70"
                                                            >
                                                                JPL ↗
                                                            </a>
                                                        )}
                                                    </div>

                                                    <MetricStrip metrics={metrics} />

                                                    <div
                                                        className={`mt-3 flex flex-wrap gap-2 transition-all duration-300 ease-out ${
                                                            isEditing
                                                                ? 'pointer-events-none max-h-0 -translate-y-1 overflow-hidden opacity-0'
                                                                : 'max-h-12 translate-y-0 opacity-100'
                                                        }`}
                                                    >
                                                        <button
                                                            onClick={() => {
                                                                setEditingName(asteroid.name);
                                                                setDraftNote(asteroid.note || '');
                                                            }}
                                                            className="border border-ink/20 bg-panel px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleRemoveAsteroid(asteroid.name)}
                                                            disabled={isLeaving}
                                                            className="border border-transparent px-4 py-2 text-sm font-semibold text-hazard transition-colors hover:border-hazard/40 disabled:opacity-50"
                                                        >
                                                            Drop
                                                        </button>
                                                    </div>
                                                </div>

                                                <div>
                                                    {isEditing ? (
                                                        <div key={`${asteroid.name}-edit`} className="vault-panel border border-line bg-panel p-4">
                                                            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                                                                Commander&apos;s log
                                                            </label>
                                                            <textarea
                                                                value={draftNote}
                                                                onChange={(event) => setDraftNote(event.target.value)}
                                                                rows={3}
                                                                className="w-full resize-none border border-line bg-white p-3 text-sm text-ink outline-none transition-colors focus:border-signal"
                                                            />
                                                            <div className="mt-3 flex gap-2">
                                                                <button
                                                                    onClick={() => handleUpdateNote(asteroid.name, draftNote)}
                                                                    className="bg-ink px-4 py-2 text-sm font-semibold text-panel transition-colors hover:bg-signal hover:text-signal-ink"
                                                                >
                                                                    Save
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingName(null);
                                                                        setDraftNote('');
                                                                    }}
                                                                    className="border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-ink/40 hover:text-ink"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div key={`${asteroid.name}-view`} className="vault-panel border border-line bg-panel/80 p-4">
                                                            <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                                                                Commander&apos;s log
                                                            </span>
                                                            <p className="text-sm italic leading-relaxed text-ink-soft">
                                                                {asteroid.note || 'No notes yet.'}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    </main>
                )}
                </>
            )}

            {toast && (
                <div
                    role="status"
                    className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border border-line bg-panel px-4 py-3 text-sm text-ink animate-fade-rise"
                >
                    {toast}
                </div>
            )}
        </div>
    );
}

export default App;
