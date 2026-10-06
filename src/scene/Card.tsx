import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { getCardDef } from '../game/cards';
import { computeView, handHoverPose, type Pose } from './layout';
import { theme } from './theme';
import {
  getBubbleTexture,
  getCardBackTexture,
  getCardFaceTexture,
  getPadlockTexture,
  getShieldTexture,
  type MonsterFaceStats,
} from './textures';

export type HaloKind = 'none' | 'playable' | 'selected' | 'target';

// Cadenas cliquable posé sur une carte du marché (demande utilisateur) : `locked` donne son
// dessin (anse fermée et dorée = gardée pour le prochain marché), `onToggle` l'action à
// envoyer. Absent sur toutes les autres cartes — c'est lui qui décide de l'affichage.
export interface LockBadge {
  locked: boolean;
  onToggle: () => void;
}

export interface AttackTrigger {
  id: number;
  targetPosition: [number, number, number];
}

interface CardProps {
  cardId: string;
  stats: MonsterFaceStats | null; // null pour un enchantement (§6.4)
  ko: boolean;
  // Marques d'habileté (demande utilisateur), superposables sur un monstre qui a les deux :
  // `tauntShield` = bouclier de la Provocation, affiché tant que le monstre est debout ;
  // `protectionBubble` = bulle de la Protection, qui éclate au coup qui la consomme.
  tauntShield?: boolean;
  protectionBubble?: boolean;
  // V2 : monstre gelé — couché à l'horizontale (comme un KO) et teinté de glace tant qu'il
  // l'est (demande utilisateur).
  frozen?: boolean;
  // Cadenas du marché, affiché et cliquable seulement si la prop est présente.
  lockBadge?: LockBadge;
  pose: Pose;
  spawnPose?: Pose; // pose de départ si la carte apparaît pour la première fois (D6)
  hidden: boolean;
  halo: HaloKind;
  hoverable: boolean;
  clickable: boolean;
  attackTrigger: AttackTrigger | null;
  // Présent uniquement pour la carte tenue en glisser-déposer : position monde du pointeur
  // (voir DragController), `null` quand la carte n'est plus tenue.
  dragWorldRef?: RefObject<THREE.Vector3 | null>;
  onSelect?: () => void;
  onDragStart?: (clientX: number, clientY: number) => void;
  // Au doigt seulement (pas de survol sur mobile) : ouvre la carte en grand. Déclenché par un
  // appui long, ou par un simple tap quand la carte n'a pas d'autre action au tap (main).
  onInspect?: () => void;
}

const DAMP_LAMBDA = 10;
const DRAG_DAMP_LAMBDA = 28; // la carte tenue suit le pointeur de près
const DRAG_SCALE = 0.8;
const LUNGE_DURATION = 0.45; // s
const SHIELD_SIZE = 0.62; // côté du plan portant l'emblème de bouclier (K2 Provocation)
// La bulle (K3 Protection) déborde juste assez de la carte pour l'envelopper sans mordre
// sur l'emplacement voisin (cartes espacées de 1.08 pour 0.96 de large, voir layout.ts).
const BUBBLE_WIDTH_RATIO = 1.12;
const BUBBLE_HEIGHT_RATIO = 1.1;
// Côté du cadenas du marché : assez grand pour être visé au clic sur une carte agrandie du
// marché (échelle ~1.6), assez petit pour ne pas masquer l'illustration.
const LOCK_SIZE = 0.42;
// Gestes au doigt : durée d'un appui long (zoom) et distance à partir de laquelle un appui
// devient un glisser. Plus tolérante qu'à la souris, un doigt bouge toujours un peu.
const LONG_PRESS_MS = 450;
const TOUCH_DRAG_THRESHOLD_PX = 10;

function haloColor(kind: HaloKind): string {
  switch (kind) {
    case 'playable':
      return theme.colors.haloPlayable;
    case 'selected':
      return theme.colors.haloSelected;
    case 'target':
      return theme.colors.haloTarget;
    default:
      return '#000000';
  }
}

function Card({
  cardId,
  stats,
  ko,
  tauntShield = false,
  protectionBubble = false,
  frozen = false,
  lockBadge,
  pose,
  spawnPose,
  hidden,
  halo,
  hoverable,
  clickable,
  attackTrigger,
  dragWorldRef,
  onSelect,
  onDragStart,
  onInspect,
}: CardProps) {
  const def = getCardDef(cardId);
  const viewWidth = useThree((s) => s.size.width);
  const viewHeight = useThree((s) => s.size.height);
  const faceTexture = useMemo(() => getCardFaceTexture(def, stats), [def, stats]);
  const backTexture = useMemo(() => getCardBackTexture(), []);
  const shieldTexture = useMemo(() => getShieldTexture(), []);
  const bubbleTexture = useMemo(() => getBubbleTexture(), []);
  // Deux textures seulement (ouverte/fermée), déjà mises en cache par `getPadlockTexture` :
  // pas de `useMemo` à tenir à jour ici.
  const padlockTexture = lockBadge ? getPadlockTexture(lockBadge.locked) : null;
  const { width, height } = theme.card;

  const groupRef = useRef<THREE.Group>(null!);
  const flipRef = useRef<THREE.Group>(null!);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const faceMaterialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const initialized = useRef(false);
  const prevDefense = useRef(stats?.defense ?? null);
  const flashIntensity = useRef(0);
  const prevGolden = useRef(stats?.golden ?? false);
  const goldFlash = useRef(0); // éclat doré au moment d'une fusion, amorti
  const goldGlowMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const lunge = useRef<{ start: number; base: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastAttackId = useRef<number | null>(null);
  const koAmount = useRef(0); // 0 = debout, 1 = KO complet (amorti)
  const frozenAmount = useRef(0); // V2 : 0 = libre, 1 = gelé (amorti)
  const shieldMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const bubbleGroupRef = useRef<THREE.Group>(null!);
  const bubbleMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const bubbleBreak = useRef(0); // éclat de la bulle au moment où la protection est consommée
  const prevProtectionBubble = useRef(protectionBubble);

  const [hovered, setHovered] = useState(false);
  // Survol du cadenas seul : il s'éclaircit et grossit un peu, pour se distinguer d'un clic
  // sur la carte (qui, au marché, achète).
  const [lockHovered, setLockHovered] = useState(false);
  const lockGroupRef = useRef<THREE.Group>(null!);
  const lockMaterialRef = useRef<THREE.MeshBasicMaterial>(null!);
  // Vrai quand le dernier appui est un appui au doigt déjà traité par `handleTouchPress` : le
  // `click` que le navigateur émet ensuite ne doit pas rejouer l'action (achat en double).
  const touchHandled = useRef(false);

  // Carte de la main : seule la zone de survol, fixe à sa place dans l'éventail, capte le
  // pointeur. La carte elle-même (agrandie, ou qui revient en place après un survol) n'est
  // jamais touchée par le rayon : sinon, en repassant sous le curseur pendant son animation,
  // elle volait le survol à sa voisine et les deux cartes clignotaient.
  useEffect(() => {
    groupRef.current?.traverse((object) => {
      if (object instanceof THREE.Mesh) object.raycast = hoverable ? () => {} : THREE.Mesh.prototype.raycast;
    });
  }, [hoverable]);

  // Pose de départ : sur mount, `spawnPose` (deck du propriétaire) si la carte est neuve,
  // sinon directement la pose cible — pas d'animation surprise au premier rendu (§7.2).
  useEffect(() => {
    if (initialized.current || !groupRef.current) return;
    const start = spawnPose ?? pose;
    groupRef.current.position.set(...start.position);
    groupRef.current.rotation.set(...start.rotation);
    groupRef.current.scale.setScalar(start.scale);
    initialized.current = true;
  }, []);

  useEffect(() => {
    const defense = stats?.defense ?? null;
    if (defense !== null && prevDefense.current !== null && defense < prevDefense.current) {
      flashIntensity.current = 1;
    }
    prevDefense.current = defense;
  }, [stats?.defense]);

  // Fusion : la carte posée devient dorée (même uid, donc même composant) — éclat + grossissement.
  useEffect(() => {
    const golden = stats?.golden ?? false;
    if (golden && !prevGolden.current) goldFlash.current = 1;
    prevGolden.current = golden;
  }, [stats?.golden]);

  // Protection consommée : la bulle enfle d'un coup puis éclate.
  useEffect(() => {
    if (!protectionBubble && prevProtectionBubble.current) bubbleBreak.current = 1;
    prevProtectionBubble.current = protectionBubble;
  }, [protectionBubble]);

  useEffect(() => {
    if (attackTrigger && attackTrigger.id !== lastAttackId.current && groupRef.current) {
      lastAttackId.current = attackTrigger.id;
      lunge.current = {
        start: performance.now(),
        base: groupRef.current.position.clone(),
        target: new THREE.Vector3(...attackTrigger.targetPosition),
      };
    }
  }, [attackTrigger]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (lunge.current) {
      const t = (performance.now() - lunge.current.start) / 1000 / LUNGE_DURATION;
      if (t >= 1) {
        lunge.current = null;
      } else {
        const k = Math.sin(Math.PI * t) * 0.85;
        const lungePos = lunge.current.base.clone().lerp(lunge.current.target, k);
        lungePos.y += Math.sin(Math.PI * t) * 0.3;
        group.position.copy(lungePos);
      }
    }

    koAmount.current = THREE.MathUtils.damp(koAmount.current, ko ? 1 : 0, DAMP_LAMBDA, delta);
    frozenAmount.current = THREE.MathUtils.damp(frozenAmount.current, frozen ? 1 : 0, DAMP_LAMBDA, delta);
    // Gelé ou KO : la carte est couchée d'un quart de tour (les deux ne se cumulent pas).
    const lying = Math.max(koAmount.current, frozenAmount.current);

    if (!lunge.current) {
      const dragPoint = dragWorldRef?.current ?? null;
      const effectivePose: Pose = dragPoint
        ? { position: [dragPoint.x, dragPoint.y, dragPoint.z], rotation: [-Math.PI / 2, 0, 0], scale: DRAG_SCALE }
        : hovered && hoverable
          ? handHoverPose(pose, computeView(viewWidth, viewHeight))
          : pose;
      const moveLambda = dragPoint ? DRAG_DAMP_LAMBDA : DAMP_LAMBDA;
      group.position.x = THREE.MathUtils.damp(group.position.x, effectivePose.position[0], moveLambda, delta);
      group.position.y = THREE.MathUtils.damp(
        group.position.y,
        effectivePose.position[1] - koAmount.current * 0.02,
        moveLambda,
        delta,
      );
      group.position.z = THREE.MathUtils.damp(group.position.z, effectivePose.position[2], moveLambda, delta);
      group.rotation.x = THREE.MathUtils.damp(group.rotation.x, effectivePose.rotation[0], DAMP_LAMBDA, delta);
      group.rotation.y = THREE.MathUtils.damp(group.rotation.y, effectivePose.rotation[1], DAMP_LAMBDA, delta);
      // KO : la carte pivote d'un quart de tour à plat sur la table (portrait → paysage,
      // donc « à l'horizontale ») ; elle revient d'elle-même à la verticale quand `ko`
      // repasse à `false` en fin de combat, via l'amortissement de `koAmount` (H1).
      group.rotation.z = THREE.MathUtils.damp(
        group.rotation.z,
        effectivePose.rotation[2] + lying * (Math.PI / 2),
        DAMP_LAMBDA,
        delta,
      );
      const scale = THREE.MathUtils.damp(
        group.scale.x,
        effectivePose.scale * (1 + goldFlash.current * 0.35),
        DAMP_LAMBDA,
        delta,
      );
      group.scale.setScalar(scale);
    }

    goldFlash.current = THREE.MathUtils.damp(goldFlash.current, 0, 2.5, delta);
    if (goldGlowMaterialRef.current) {
      // Liseré doré permanent qui scintille doucement, renforcé pendant l'éclat de fusion.
      const shimmer = 0.45 + Math.sin(performance.now() / 350) * 0.15;
      const target = stats?.golden && !hidden ? Math.min(1, shimmer + goldFlash.current) : 0;
      goldGlowMaterialRef.current.opacity = THREE.MathUtils.damp(
        goldGlowMaterialRef.current.opacity,
        target,
        DAMP_LAMBDA,
        delta,
      );
    }

    if (shieldMaterialRef.current) {
      const shimmer = 0.68 + Math.sin(performance.now() / 420) * 0.14;
      shieldMaterialRef.current.opacity = THREE.MathUtils.damp(
        shieldMaterialRef.current.opacity,
        tauntShield ? shimmer : 0,
        DAMP_LAMBDA,
        delta,
      );
      shieldMaterialRef.current.visible = shieldMaterialRef.current.opacity > 0.01;
    }

    bubbleBreak.current = THREE.MathUtils.damp(bubbleBreak.current, 0, 5, delta);
    if (bubbleMaterialRef.current && bubbleGroupRef.current) {
      // Respiration lente de la coque, puis éclat bref quand la protection est consommée.
      const shimmer = 0.8 + Math.sin(performance.now() / 520) * 0.18;
      const target = protectionBubble ? shimmer : 0;
      // L'éclat de rupture prend le dessus sur la disparition, le temps de s'estomper.
      bubbleMaterialRef.current.opacity = Math.max(
        THREE.MathUtils.damp(bubbleMaterialRef.current.opacity, target, 14, delta),
        bubbleBreak.current,
      );
      const scale = (protectionBubble ? 1 : 1.18) + bubbleBreak.current * 0.3;
      bubbleGroupRef.current.scale.setScalar(
        THREE.MathUtils.damp(bubbleGroupRef.current.scale.x, scale, 14, delta),
      );
      bubbleGroupRef.current.visible = bubbleMaterialRef.current.opacity > 0.01;
    }

    if (lockGroupRef.current && lockMaterialRef.current) {
      // Un cadenas déjà fermé reste bien visible ; ouvert, il s'efface jusqu'au survol pour
      // ne pas voler la vedette à la face de la carte.
      const base = lockBadge?.locked ? 1 : 0.5;
      lockMaterialRef.current.opacity = THREE.MathUtils.damp(
        lockMaterialRef.current.opacity,
        lockHovered ? 1 : base,
        DAMP_LAMBDA,
        delta,
      );
      const scale = THREE.MathUtils.damp(lockGroupRef.current.scale.x, lockHovered ? 1.18 : 1, DAMP_LAMBDA, delta);
      lockGroupRef.current.scale.setScalar(scale);
    }

    if (flipRef.current) {
      const targetY = hidden ? Math.PI : 0;
      flipRef.current.rotation.y = THREE.MathUtils.damp(flipRef.current.rotation.y, targetY, DAMP_LAMBDA, delta);
    }

    if (haloMaterialRef.current) {
      const pulse = 0.55 + Math.sin(performance.now() / 200) * 0.2;
      const targetOpacity = halo === 'none' ? 0 : pulse;
      haloMaterialRef.current.opacity = THREE.MathUtils.damp(
        haloMaterialRef.current.opacity,
        targetOpacity,
        DAMP_LAMBDA,
        delta,
      );
      haloMaterialRef.current.color.set(haloColor(halo));
    }

    if (faceMaterialRef.current) {
      flashIntensity.current = THREE.MathUtils.damp(flashIntensity.current, 0, 6, delta);
      const gold = goldFlash.current;
      faceMaterialRef.current.emissive.setRGB(
        Math.min(1, flashIntensity.current + gold * 0.9),
        gold * 0.7,
        gold * 0.15,
      );
      // Face assombrie pendant le KO (§6.4).
      const darken = 1 - koAmount.current * 0.65;
      // V2 : reflet de glace sur un monstre gelé (rouge et vert baissés, le bleu reste).
      const ice = frozenAmount.current;
      faceMaterialRef.current.color.setRGB(darken * (1 - ice * 0.45), darken * (1 - ice * 0.2), darken);
      // Léger tremblement pendant le flash de dégâts.
      if (flashIntensity.current > 0.05) {
        group.position.x += (Math.random() - 0.5) * 0.02 * flashIntensity.current;
      }
    }
  });

  // Appui au doigt : glisser au-delà du seuil -> drag (si la carte se déplace), appui long ->
  // zoom, tap -> action de la carte (achat, zoom d'une carte posée), ou zoom si elle n'en a
  // pas (carte de la main).
  function handleTouchPress(startX: number, startY: number) {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      setHovered(false);
      onInspect?.();
    }, LONG_PRESS_MS);
    const onMove = (ev: PointerEvent) => {
      if (settled || Math.hypot(ev.clientX - startX, ev.clientY - startY) <= TOUCH_DRAG_THRESHOLD_PX) return;
      settled = true;
      cleanup();
      if (onDragStart) {
        setHovered(false);
        onDragStart(startX, startY);
      }
    };
    const onUp = () => {
      if (settled) return;
      settled = true;
      cleanup();
      setHovered(false);
      if (clickable && onSelect) onSelect();
      else onInspect?.();
    };
    const onCancel = () => {
      settled = true;
      cleanup();
      setHovered(false);
    };
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  return (
    <group
      onClick={(e) => {
        if (touchHandled.current) {
          touchHandled.current = false;
          e.stopPropagation();
          return;
        }
        // Quand la carte accepte aussi le glisser (carte posée déplaçable), le clic est géré
        // par le seuil de mouvement ci-dessous (onPointerDown) pour ne pas ouvrir le zoom au
        // simple relâchement d'un début de glisser.
        if (!clickable || onDragStart) return;
        e.stopPropagation();
        onSelect?.();
      }}
      onPointerDown={(e) => {
        touchHandled.current = false;
        if (onInspect && e.nativeEvent.pointerType !== 'mouse') {
          e.stopPropagation();
          touchHandled.current = true;
          handleTouchPress(e.nativeEvent.clientX, e.nativeEvent.clientY);
          return;
        }
        if (!onDragStart || e.nativeEvent.button !== 0) return;
        e.stopPropagation();
        // Une carte à la fois cliquable (zoom) et glissable (déplacement posé) : on ne décide
        // entre les deux qu'après un léger seuil de mouvement, pour ne pas perdre le clic.
        if (clickable && onSelect) {
          const startX = e.nativeEvent.clientX;
          const startY = e.nativeEvent.clientY;
          const threshold = 6;
          let dragStarted = false;
          const onMove = (ev: PointerEvent) => {
            if (dragStarted) return;
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > threshold) {
              dragStarted = true;
              cleanup();
              setHovered(false);
              onDragStart(startX, startY);
            }
          };
          const onUp = () => {
            cleanup();
            if (!dragStarted) onSelect();
          };
          function cleanup() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          }
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          return;
        }
        setHovered(false);
        onDragStart(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerOver={(e) => {
        if (!hoverable) return;
        e.stopPropagation();
        setHovered(true);
        if (onDragStart) document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        setHovered(false);
        if (onDragStart && document.body.style.cursor === 'grab') document.body.style.cursor = '';
      }}
    >
      {/* Zone de survol d'une carte de la main, fixe à sa place dans l'éventail : la carte
          agrandie déborde largement sur ses voisines, elle ne capte donc pas le pointeur
          (voir l'effet sur `hovered`) et passer d'une carte à l'autre reste fluide. */}
      {hoverable && (
        <mesh position={pose.position} rotation={pose.rotation} scale={pose.scale}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
      <group ref={groupRef}>
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[width + 0.12, height + 0.12]} />
          <meshBasicMaterial ref={haloMaterialRef} color="#000000" transparent opacity={0} />
        </mesh>

        <mesh position={[0, 0, -0.015]}>
          <planeGeometry args={[width + 0.26, height + 0.26]} />
          <meshBasicMaterial ref={goldGlowMaterialRef} color={theme.colors.gold} transparent opacity={0} />
        </mesh>

        {/* Marques d'habileté : au-dessus de la face, elles ne pivotent pas avec elle et se
            superposent (bulle de Protection autour de la carte, bouclier de Provocation
            par-dessus) sur un monstre qui a les deux. */}
        <group ref={bubbleGroupRef} position={[0, 0, 0.035]} visible={false}>
          <mesh>
            <planeGeometry args={[width * BUBBLE_WIDTH_RATIO, height * BUBBLE_HEIGHT_RATIO]} />
            <meshBasicMaterial
              ref={bubbleMaterialRef}
              map={bubbleTexture}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>

        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[SHIELD_SIZE, SHIELD_SIZE]} />
          <meshBasicMaterial
            ref={shieldMaterialRef}
            map={shieldTexture}
            transparent
            opacity={0}
            visible={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Cadenas du marché : en bas au centre de la carte, par-dessus la gemme de rareté
            (40 px du bas sur une face de 420, voir textures.ts), au-dessus de la face et hors du
            groupe qui pivote, avec sa propre zone de clic (il n'achète pas la carte). */}
        {lockBadge && padlockTexture && (
          <group
            ref={lockGroupRef}
            position={[0, -height / 2 + (height * 40) / 420, 0.06]}
            onClick={(e) => {
              e.stopPropagation();
              lockBadge.onToggle();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerOver={(e) => {
              e.stopPropagation();
              setLockHovered(true);
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              setLockHovered(false);
              if (document.body.style.cursor === 'pointer') document.body.style.cursor = '';
            }}
          >
            <mesh>
              <planeGeometry args={[LOCK_SIZE, LOCK_SIZE]} />
              <meshBasicMaterial
                ref={lockMaterialRef}
                map={padlockTexture}
                transparent
                opacity={0}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        )}

        <group ref={flipRef}>
          <mesh>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial ref={faceMaterialRef} map={faceTexture} transparent alphaTest={0.1} />
          </mesh>
          <mesh rotation-y={Math.PI}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial map={backTexture} transparent alphaTest={0.1} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export default Card;
