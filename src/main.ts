// --- Configuration ---

const DESIGN_REFERENCE_SIZE = 800

const COLORS = {
  background: '#10131f'
} as const

const SIMULATION = {
  referenceFramesPerSecond: 60,
  maxDeltaTimeSeconds: 0.1,
} as const

const LAYOUT = {
  canvasPadding: -256,
} as const

const PHYSICS = {
  minCollisionTime: 1e-6,
  gapAfterContact: 1e-4,
  maxOverlapFixAttempts: 4,
  maxCollisionChecksPerFrame: 16,
} as const

// --- Types ---

type Vec2 = { x: number; y: number }

type SphereConfig = {
  x: number
  y: number
  radius: number
  velocity: Vec2
  speed: number
  mass: number
}

type CircleBounds = { x: number; y: number; radius: number }

type Body1D = {
  mass: number
  velocity: number
}

type CollisionEvent =
  | { kind: 'none' }
  | { kind: 'wall'; sphereIndex: number; time: number }
  | { kind: 'sphere'; sphereAIndex: number; sphereBIndex: number; time: number }

// Elastic (perfectly bouncy) sphere-sphere collisions — restitution coefficient e = 1.
const SPHERE_COLLISION_RESTITUTION = 1

// --- Viewport ---

class Viewport {
  width: number
  height: number
  scale: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.scale = Math.min(width, height) / DESIGN_REFERENCE_SIZE
  }

  scaleToPixels(designValue: number) {
    return designValue * this.scale
  }
}

// --- Canvas renderer ---

class CanvasRenderer {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  resizeListeners: Array<(width: number, height: number) => void>

  constructor(canvasId: string) {
    const element = document.getElementById(canvasId)

    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas element "${canvasId}" not found`)
    }

    const context = element.getContext('2d')

    if (!context) {
      throw new Error('2D context not available')
    }

    this.canvas = element
    this.context = context
    this.resizeListeners = []

    this.handleResize = this.handleResize.bind(this)

    this.handleResize()
    window.addEventListener('resize', this.handleResize)
  }

  get width() {
    return this.canvas.width
  }

  get height() {
    return this.canvas.height
  }

  clear() {
    this.context.clearRect(0, 0, this.width, this.height)
  }

  fillBackground() {
    this.context.fillStyle = COLORS.background
    this.context.fillRect(0, 0, this.width, this.height)
  }

  addResizeListener(listener: (width: number, height: number) => void) {
    this.resizeListeners.push(listener)
  }

  handleResize() {
    const previousWidth = this.canvas.width
    const previousHeight = this.canvas.height

    this.canvas.width = window.innerWidth - LAYOUT.canvasPadding
    this.canvas.height = window.innerHeight - LAYOUT.canvasPadding

    if (this.canvas.width === previousWidth && this.canvas.height === previousHeight) {
      return
    }

    for (const listener of this.resizeListeners) {
      listener(this.width, this.height)
    }
  }
}

// --- Vector math ---

function dotProduct(a: Vec2, b: Vec2) {
  return a.x * b.x + a.y * b.y
}

// --- Circle geometry ---

function centerDistance(sphereA: Sphere, sphereB: Sphere) {
  return Math.hypot(sphereB.x - sphereA.x, sphereB.y - sphereA.y)
}

function touchDistance(sphereA: Sphere, sphereB: Sphere) {
  return sphereA.radius + sphereB.radius
}

function areCirclesOverlapping(a: CircleBounds, b: CircleBounds) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  return distance <= a.radius + b.radius
}

function unitDirectionFromAToB(sphereA: Sphere, sphereB: Sphere): Vec2 {
  const distance = centerDistance(sphereA, sphereB)

  if (distance < 1e-10) {
    return { x: 1, y: 0 }
  }

  return {
    x: (sphereB.x - sphereA.x) / distance,
    y: (sphereB.y - sphereA.y) / distance,
  }
}

function areMovingTowardEachOther(sphereA: Sphere, sphereB: Sphere, directionFromAToB: Vec2) {
  const relativeVelocity = {
    x: sphereA.velocity.x - sphereB.velocity.x,
    y: sphereA.velocity.y - sphereB.velocity.y,
  }

  // Positive dot product means A's relative velocity points toward B.
  return dotProduct(relativeVelocity, directionFromAToB) > 0
}

// --- 1D elastic collision (used to resolve sphere-sphere bounces) ---

function getVelocityAlongNormal(velocity: Vec2, normal: Vec2) {
  // Scalar projection of velocity onto the collision normal: u = v · n
  return dotProduct(velocity, normal)
}

function getVelocityAfter1DCollision(body: Body1D, otherBody: Body1D, restitution: number) {
  // 1D elastic collision formula (restitution e):
  //
  //   u₁' = ((m₁ − e·m₂)·u₁ + (1 + e)·m₂·u₂) / (m₁ + m₂)
  //
  // Applied only to the velocity component along the collision normal.

  return (
    ((body.mass - restitution * otherBody.mass) * body.velocity +
      (1 + restitution) * otherBody.mass * otherBody.velocity) /
    (body.mass + otherBody.mass)
  )
}

function addVelocityAlongNormal(velocity: Vec2, normal: Vec2, velocityChange: number) {
  // Convert a 1D velocity change back to 2D:
  //
  //   v' = v + Δu · n

  velocity.x += velocityChange * normal.x
  velocity.y += velocityChange * normal.y
}

function bounceVelocity(sphereA: Sphere, sphereB: Sphere, normal: Vec2): void {
  // 2D sphere collision via normal/tangent decomposition:
  //
  // 1. Project velocities onto the collision normal:
  //      uₐ = vₐ · n,   uᵦ = vᵦ · n
  //
  // 2. Solve the 1D collision along n for each body.
  //
  // 3. Add only the changed normal component back:
  //      vₐ' = vₐ + (uₐ' − uₐ)·n
  //      vᵦ' = vᵦ + (uᵦ' − uᵦ)·n
  //
  // Tangential components are unchanged (frictionless spheres).

  if (dotProduct(normal, normal) < 1e-10) return

  const bodyA = {
    mass: sphereA.mass,
    velocity: getVelocityAlongNormal(sphereA.velocity, normal),
  }

  const bodyB = {
    mass: sphereB.mass,
    velocity: getVelocityAlongNormal(sphereB.velocity, normal),
  }

  const nextVelocityA = getVelocityAfter1DCollision(bodyA, bodyB, SPHERE_COLLISION_RESTITUTION)

  const nextVelocityB = getVelocityAfter1DCollision(bodyB, bodyA, SPHERE_COLLISION_RESTITUTION)

  addVelocityAlongNormal(sphereA.velocity, normal, nextVelocityA - bodyA.velocity)

  addVelocityAlongNormal(sphereB.velocity, normal, nextVelocityB - bodyB.velocity)
}

// Keeps each sphere moving at its configured constant speed after a bounce.
function normalizeSphereSpeed(sphere: Sphere) {
  const currentSpeed = Math.hypot(sphere.velocity.x, sphere.velocity.y)

  if (currentSpeed < 1e-10) {
    sphere.velocity = { x: sphere.speed, y: 0 }
    return
  }

  const scale = sphere.speed / currentSpeed
  sphere.velocity.x *= scale
  sphere.velocity.y *= scale
}

// --- CCD helpers: pick the earliest valid collision time in a window ---

function pickMinimumTimeInWindow(
  candidates: Array<number | null>,
  maxInclusive: number,
  minExclusive: number,
): number | null {
  let earliest: number | null = null

  for (const time of candidates) {
    if (
      time !== null &&
      time > minExclusive &&
      time <= maxInclusive &&
      (earliest === null || time < earliest)
    ) {
      earliest = time
    }
  }

  return earliest
}

// --- CCD: sphere–sphere first-touch time ---

function solveEarliestTouchTime(
  centerOffsetX: number,
  centerOffsetY: number,
  relativeVelocityX: number,
  relativeVelocityY: number,
  touchRadius: number,
  withinTime: number,
): number | null {
  /*
    Continuous Collision Detection (CCD) for two moving circles.

    Find time t when center distance equals the sum of radii:

      |r + v·t| = R

    Squaring both sides avoids sqrt and yields a quadratic:

      (v·v)t² + 2(r·v)t + (r·r − R²) = 0

    Where:
      r = current offset between centers
      v = relative velocity
      R = sum of radii (touch distance)
  */

  // r·r — current squared center distance
  const currentDistanceSquared = centerOffsetX * centerOffsetX + centerOffsetY * centerOffsetY

  // R² — squared touch distance (radiusA + radiusB)
  const touchRadiusSquared = touchRadius * touchRadius

  // Already touching/overlapping: no future "first touch" to solve.
  if (currentDistanceSquared <= touchRadiusSquared) {
    return null
  }

  // v·v — quadratic coefficient a; zero means no relative motion
  const relativeSpeedSquared =
    relativeVelocityX * relativeVelocityX + relativeVelocityY * relativeVelocityY

  if (relativeSpeedSquared < 1e-10) {
    return null
  }

  // r·v — sign indicates closing (< 0), sideways (= 0), or separating (> 0)
  const offsetDotRelativeVelocity =
    centerOffsetX * relativeVelocityX + centerOffsetY * relativeVelocityY

  const quadraticA = relativeSpeedSquared
  const quadraticB = 2 * offsetDotRelativeVelocity
  const quadraticC = currentDistanceSquared - touchRadiusSquared

  // Discriminant D = b² − 4ac — negative means the circles never touch
  const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC

  if (discriminant < 0) {
    return null
  }

  const sqrtDiscriminant = Math.sqrt(discriminant)
  const denominator = 2 * quadraticA

  // t₁ = (−b − √D) / 2a  — first contact
  // t₂ = (−b + √D) / 2a  — second contact (if trajectories continued)
  const firstTouchTime = (-quadraticB - sqrtDiscriminant) / denominator

  const secondTouchTime = (-quadraticB + sqrtDiscriminant) / denominator

  return pickMinimumTimeInWindow(
    [firstTouchTime, secondTouchTime],
    withinTime,
    PHYSICS.minCollisionTime,
  )
}

function timeUntilSpheresTouch(
  sphereA: Sphere,
  sphereB: Sphere,
  withinTime: number,
): number | null {
  return solveEarliestTouchTime(
    sphereB.x - sphereA.x,
    sphereB.y - sphereA.y,
    sphereB.velocity.x - sphereA.velocity.x,
    sphereB.velocity.y - sphereA.velocity.y,
    touchDistance(sphereA, sphereB),
    withinTime,
  )
}

// --- CCD: sphere–wall first-hit time ---

function isSphereOutsideCanvas(sphere: Sphere, viewport: Viewport) {
  const { width, height } = viewport

  return (
    sphere.x - sphere.radius < 0 ||
    sphere.x + sphere.radius > width ||
    sphere.y - sphere.radius < 0 ||
    sphere.y + sphere.radius > height
  )
}

// Generic 1D CCD: time until a moving point reaches a target coordinate.
// Returns null when the point is not moving toward the target.
function timeUntilPositionReachesTarget(
  currentPosition: number,
  targetPosition: number,
  velocity: number,
): number | null {
  const displacement = targetPosition - currentPosition

  if (displacement * velocity <= 0) {
    return null
  }

  return displacement / velocity
}

function getWallTargetPositions(sphere: Sphere, viewport: Viewport) {
  const { width, height } = viewport

  return {
    left: sphere.radius,
    right: width - sphere.radius,
    top: sphere.radius,
    bottom: height - sphere.radius,
  }
}

function timeUntilSphereHitsWall(
  sphere: Sphere,
  viewport: Viewport,
  withinTime: number,
): number | null {
  if (isSphereOutsideCanvas(sphere, viewport)) {
    return null
  }

  const walls = getWallTargetPositions(sphere, viewport)

  return pickMinimumTimeInWindow(
    [
      timeUntilPositionReachesTarget(sphere.x, walls.left, sphere.velocity.x),
      timeUntilPositionReachesTarget(sphere.x, walls.right, sphere.velocity.x),
      timeUntilPositionReachesTarget(sphere.y, walls.top, sphere.velocity.y),
      timeUntilPositionReachesTarget(sphere.y, walls.bottom, sphere.velocity.y),
    ],
    withinTime,
    0,
  )
}

// --- Collision response: separate overlapping bodies and apply bounces ---

function pushSpheresApart(sphereA: Sphere, sphereB: Sphere, directionFromAToB: Vec2) {
  const distance = centerDistance(sphereA, sphereB)
  const desiredDistance = touchDistance(sphereA, sphereB) + PHYSICS.gapAfterContact

  if (distance >= desiredDistance) return

  const overlap = desiredDistance - distance
  const halfPushX = (overlap / 2) * directionFromAToB.x
  const halfPushY = (overlap / 2) * directionFromAToB.y

  sphereA.x -= halfPushX
  sphereA.y -= halfPushY
  sphereB.x += halfPushX
  sphereB.y += halfPushY
}

function handleSpheresTouching(sphereA: Sphere, sphereB: Sphere) {
  const directionFromAToB = unitDirectionFromAToB(sphereA, sphereB)

  if (areMovingTowardEachOther(sphereA, sphereB, directionFromAToB)) {
    bounceVelocity(sphereA, sphereB, directionFromAToB)
    normalizeSphereSpeed(sphereA)
    normalizeSphereSpeed(sphereB)
  }

  pushSpheresApart(sphereA, sphereB, directionFromAToB)
}

function fixOverlappingSpheres(spheres: Sphere[]) {
  for (let attempt = 0; attempt < PHYSICS.maxOverlapFixAttempts; attempt++) {
    let fixedAnyOverlap = false

    for (let i = 0; i < spheres.length; i++) {
      for (let j = i + 1; j < spheres.length; j++) {
        if (areCirclesOverlapping(spheres[i], spheres[j])) {
          handleSpheresTouching(spheres[i], spheres[j])
          fixedAnyOverlap = true
        }
      }
    }

    if (!fixedAnyOverlap) break
  }
}

function bounceSphereOffAxis(
  sphere: Sphere,
  axis: 'x' | 'y',
  clampedPosition: number,
  shouldFlipVelocity: (velocity: number) => boolean,
) {
  if (axis === 'x') {
    sphere.x = clampedPosition
    if (shouldFlipVelocity(sphere.velocity.x)) {
      sphere.velocity.x *= -1
    }
  } else {
    sphere.y = clampedPosition
    if (shouldFlipVelocity(sphere.velocity.y)) {
      sphere.velocity.y *= -1
    }
  }

  normalizeSphereSpeed(sphere)
}

function handleSphereOutsideWall(sphere: Sphere, viewport: Viewport) {
  const { width, height } = viewport

  if (sphere.x - sphere.radius < 0) {
    bounceSphereOffAxis(
      sphere,
      'x',
      sphere.radius + PHYSICS.gapAfterContact,
      (velocity) => velocity < 0,
    )
  } else if (sphere.x + sphere.radius > width) {
    bounceSphereOffAxis(
      sphere,
      'x',
      width - sphere.radius - PHYSICS.gapAfterContact,
      (velocity) => velocity > 0,
    )
  }

  if (sphere.y - sphere.radius < 0) {
    bounceSphereOffAxis(
      sphere,
      'y',
      sphere.radius + PHYSICS.gapAfterContact,
      (velocity) => velocity < 0,
    )
  } else if (sphere.y + sphere.radius > height) {
    bounceSphereOffAxis(
      sphere,
      'y',
      height - sphere.radius - PHYSICS.gapAfterContact,
      (velocity) => velocity > 0,
    )
  }
}

function fixSpheresOutsideWalls(spheres: Sphere[], viewport: Viewport) {
  for (const sphere of spheres) {
    handleSphereOutsideWall(sphere, viewport)
  }
}

// --- CCD event scheduling ---

function findEarliestWallCollision(
  spheres: Sphere[],
  viewport: Viewport,
  withinTime: number,
): CollisionEvent {
  let earliestEvent: CollisionEvent = { kind: 'none' }
  let earliestTime = withinTime

  for (let sphereIndex = 0; sphereIndex < spheres.length; sphereIndex++) {
    const wallHitTime = timeUntilSphereHitsWall(spheres[sphereIndex], viewport, earliestTime)

    if (wallHitTime !== null && wallHitTime < earliestTime) {
      earliestTime = wallHitTime
      earliestEvent = { kind: 'wall', sphereIndex, time: wallHitTime }
    }
  }

  return earliestEvent
}

function findEarliestSphereCollision(spheres: Sphere[], withinTime: number): CollisionEvent {
  let earliestEvent: CollisionEvent = { kind: 'none' }
  let earliestTime = withinTime

  for (let sphereAIndex = 0; sphereAIndex < spheres.length; sphereAIndex++) {
    for (let sphereBIndex = sphereAIndex + 1; sphereBIndex < spheres.length; sphereBIndex++) {
      const touchTime = timeUntilSpheresTouch(
        spheres[sphereAIndex],
        spheres[sphereBIndex],
        earliestTime,
      )

      if (touchTime !== null && touchTime < earliestTime) {
        earliestTime = touchTime
        earliestEvent = {
          kind: 'sphere',
          sphereAIndex,
          sphereBIndex,
          time: touchTime,
        }
      }
    }
  }

  return earliestEvent
}

function findNextCollision(
  spheres: Sphere[],
  viewport: Viewport,
  withinTime: number,
): CollisionEvent {
  const wallEvent = findEarliestWallCollision(spheres, viewport, withinTime)
  const searchWindow = wallEvent.kind === 'none' ? withinTime : wallEvent.time

  const sphereEvent = findEarliestSphereCollision(spheres, searchWindow)

  if (
    sphereEvent.kind !== 'none' &&
    (wallEvent.kind === 'none' || sphereEvent.time < wallEvent.time)
  ) {
    return sphereEvent
  }

  return wallEvent
}

function moveAllSpheres(spheres: Sphere[], deltaTimeSeconds: number) {
  for (const sphere of spheres) {
    sphere.moveBy(deltaTimeSeconds)
  }
}

function respondToCollision(event: CollisionEvent, spheres: Sphere[], viewport: Viewport) {
  if (event.kind === 'sphere') {
    handleSpheresTouching(spheres[event.sphereAIndex], spheres[event.sphereBIndex])
    fixOverlappingSpheres(spheres)
    return
  }

  if (event.kind === 'wall') {
    handleSphereOutsideWall(spheres[event.sphereIndex], viewport)
  }
}

/*
  CCD simulation loop for one frame.

  Instead of moving spheres by the full frame delta and then fixing penetrations
  (discrete collision detection), we:
    1. Find the earliest collision within the remaining frame time.
    2. Advance all spheres only up to that instant.
    3. Resolve the collision (bounce + positional correction).
    4. Repeat until the frame time is consumed or the check budget is reached.

  This prevents fast spheres from tunneling through walls or each other.
*/
function processCollisionSubstep(
  spheres: Sphere[],
  viewport: Viewport,
  remainingFrameTime: number,
): { remainingTime: number; frameComplete: boolean } {
  const nextCollision = findNextCollision(spheres, viewport, remainingFrameTime)

  if (nextCollision.kind === 'none') {
    moveAllSpheres(spheres, remainingFrameTime)
    fixSpheresOutsideWalls(spheres, viewport)
    return { remainingTime: 0, frameComplete: true }
  }

  moveAllSpheres(spheres, nextCollision.time)
  respondToCollision(nextCollision, spheres, viewport)
  fixSpheresOutsideWalls(spheres, viewport)

  return {
    remainingTime: remainingFrameTime - nextCollision.time,
    frameComplete: false,
  }
}

function simulateSpheres(spheres: Sphere[], viewport: Viewport, deltaTimeSeconds: number) {
  fixOverlappingSpheres(spheres)
  fixSpheresOutsideWalls(spheres, viewport)

  let remainingFrameTime = deltaTimeSeconds

  for (
    let check = 0;
    check < PHYSICS.maxCollisionChecksPerFrame && remainingFrameTime > PHYSICS.minCollisionTime;
    check++
  ) {
    const substep = processCollisionSubstep(spheres, viewport, remainingFrameTime)

    if (substep.frameComplete) {
      return
    }

    remainingFrameTime = substep.remainingTime
  }

  if (remainingFrameTime > PHYSICS.minCollisionTime) {
    moveAllSpheres(spheres, remainingFrameTime)
    fixSpheresOutsideWalls(spheres, viewport)
  }
}

// --- Sphere entity ---

class Sphere {
  x: number
  y: number
  radius: number
  velocity: Vec2
  speed: number
  mass: number

  constructor({ x, y, radius, velocity, speed, mass }: SphereConfig) {
    this.x = x
    this.y = y
    this.radius = radius
    this.velocity = velocity
    this.speed = speed
    this.mass = mass
  }

  draw(context: CanvasRenderingContext2D) {
    const radius = this.radius
  
    context.save()
    context.translate(this.x, this.y)
  
    context.globalCompositeOperation = 'overlay'
  
    // Main transparent bubble body.
    const bodyGradient = context.createRadialGradient(
      -radius * 0.35,
      -radius * 0.35,
      radius * 0.05,
      0,
      0,
      radius,
    )

    bodyGradient.addColorStop(0.35, 'transparent')
    bodyGradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.1)')
    bodyGradient.addColorStop(0.99, 'rgba(255, 255, 255, 0.75)')
    bodyGradient.addColorStop(1, 'rgba(255, 255, 255, 1)')
  
    context.beginPath()
    context.fillStyle = bodyGradient
    context.arc(0, 0, radius, 0, Math.PI * 2)
    context.fill()
  
    // Main white highlight.
    context.beginPath()
    context.fillStyle = 'rgba(255, 255, 255, 1)'
    context.ellipse(
      -radius * 0.35,
      -radius * 0.4,
      radius * 0.12,
      radius * 0.08,
      -Math.PI * 0.25,
      0,
      Math.PI * 2,
    )
    context.fill()
  
    // Small secondary highlight.
    context.beginPath()
    context.fillStyle = 'rgba(255, 255, 255, 1)'
    context.arc(radius * 0.35, radius * 0.25, radius * 0.05, 0, Math.PI * 2)
    context.fill()
  
    context.restore()
  }

  moveBy(deltaTimeSeconds: number) {
    this.x += this.velocity.x * deltaTimeSeconds
    this.y += this.velocity.y * deltaTimeSeconds
  }
}

// --- Scene spawning ---

function randomGaussian(mean = 0, standardDeviation = 1) {
  let u = 0
  let v = 0

  // Math.random() can return 0; log(0) is undefined, so reject zeros.
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()

  // Box–Muller transform: two uniform samples → one standard normal Z ~ N(0, 1)
  //   Z = √(−2 ln u) · cos(2πv)
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)

  // Affine transform to arbitrary Gaussian: X = μ + σZ
  return mean + standardDeviation * z
}

function createRandomSphereRadius(minRadius: number, maxRadius: number) {
  // μ at the midpoint, σ spanning roughly ±3σ across [min, max] (68–99.7 rule)
  const mean = (minRadius + maxRadius) / 2
  const standardDeviation = (maxRadius - minRadius) / 6

  let radius: number

  do {
    radius = randomGaussian(mean, standardDeviation)
  } while (radius < minRadius || radius > maxRadius)

  return radius
}

function getSphereSpeedPixelsPerSecond(viewport: Viewport, speed: number) {
  // Layer speed is defined per reference frame; scale to pixels and to real seconds.
  return viewport.scaleToPixels(speed) * SIMULATION.referenceFramesPerSecond
}

function createRandomSphereVelocity(speed: number): Vec2 {
  const angle = Math.random() * Math.PI * 2

  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
  }
}

function canPlaceSphereAt(
  x: number,
  y: number,
  radius: number,
  viewport: Viewport,
  spheres: Sphere[],
) {
  const { width, height } = viewport

  return (
    !spheres.some((sphere) => areCirclesOverlapping(sphere, { x, y, radius })) &&
    x - radius >= 0 &&
    y - radius >= 0 &&
    x + radius <= width &&
    y + radius <= height
  )
}

function tryCreateRandomSphere(
  viewport: Viewport,
  existingSpheres: Sphere[],
  speed: number,
  minRadius: number,
  maxRadius: number,
): Sphere | null {
  const { width, height } = viewport
  const x = Math.floor(Math.random() * width)
  const y = Math.floor(Math.random() * height)
  const radius = createRandomSphereRadius(minRadius, maxRadius)

  if (!canPlaceSphereAt(x, y, radius, viewport, existingSpheres)) {
    return null
  }

  return new Sphere({
    x,
    y,
    radius,
    speed,
    velocity: createRandomSphereVelocity(speed),
    // All spheres have equal mass by design
    mass: 1,
  })
}

type SphereLayerConfig = {
  count: number
  minRadius: number
  maxRadius: number
  speed: number
  alpha: number
}

class SphereLayer {
  spheres: Sphere[]
  config: SphereLayerConfig

  constructor(viewport: Viewport, config: SphereLayerConfig) {
    this.config = config
    this.spheres = SphereLayer.spawnSpheres(viewport, config)
  }
  
  static spawnSpheres(viewport: Viewport, config: SphereLayerConfig) {
    const spheres: Sphere[] = []
    const speed = getSphereSpeedPixelsPerSecond(viewport, config.speed)

    let spawnedCount = 0

    while (spawnedCount < config.count) {
      const sphere = tryCreateRandomSphere(
        viewport, 
        spheres, 
        speed, 
        config.minRadius, 
        config.maxRadius
      )

      if (sphere === null) {
        continue
      }

      spheres.push(sphere)
      spawnedCount++
    }

    return spheres
  }

  update(viewport: Viewport, deltaTimeSeconds: number) {
    simulateSpheres(this.spheres, viewport, deltaTimeSeconds)
  }

  draw(context: CanvasRenderingContext2D) {
    context.save()
    context.globalAlpha = this.config.alpha

    for (const sphere of this.spheres) {
      sphere.draw(context)
    }

    context.restore()
  }
}

class Scene {
  layers: SphereLayer[]

  constructor(viewport: Viewport) {
    this.layers = [
      new SphereLayer(viewport, {
        count: 16,
        minRadius: 20,
        maxRadius: 150,
        speed: 0.45,
        alpha: 1,
      }),
      new SphereLayer(viewport, {
        count: 12,
        minRadius: 50,
        maxRadius: 200,
        speed: 0.3,
        alpha: 0.45,
      }),
      new SphereLayer(viewport, {
        count: 8,
        minRadius: 100,
        maxRadius: 250,
        speed: 0.15,
        alpha: 0.15,
      }),
    ]
  }

  update(viewport: Viewport, deltaTimeSeconds: number) {
    for (const layer of this.layers) {
      layer.update(viewport, deltaTimeSeconds)
    }
  }

  draw(context: CanvasRenderingContext2D) {
    for (const layer of this.layers) {
      layer.draw(context)
    }
  }
}

// --- Engine ---

class Engine {
  renderer: CanvasRenderer
  viewport: Viewport
  scene: Scene

  constructor(canvasId = 'canvas') {
    this.renderer = new CanvasRenderer(canvasId)
    this.viewport = new Viewport(this.renderer.width, this.renderer.height)
    this.scene = new Scene(this.viewport)

    this.renderer.addResizeListener(() => {
      this.viewport = new Viewport(this.renderer.width, this.renderer.height)
      this.scene = new Scene(this.viewport)
    })
  }

  start() {
    let lastFrameTimeMs: number | null = null

    const renderFrame = (frameTimeMs: number) => {
      if (lastFrameTimeMs !== null) {
        const deltaTimeSeconds = Math.min(
          (frameTimeMs - lastFrameTimeMs) / 1000,
          SIMULATION.maxDeltaTimeSeconds,
        )

        this.renderer.clear()
        this.renderer.fillBackground()
        this.scene.update(this.viewport, deltaTimeSeconds)
        this.scene.draw(this.renderer.context)
      }

      lastFrameTimeMs = frameTimeMs
      requestAnimationFrame(renderFrame)
    }

    requestAnimationFrame(renderFrame)
  }
}

// --- Bootstrap ---

const engine = new Engine('canvas')
engine.start()
