// --- Configuration ---

const DESIGN_REFERENCE_SIZE = 800

const COLORS = {
  background: '#111111',
  sphereStroke: '#ffffff',
} as const

const SPHERE = {
  maxRadius: 100,
  minRadius: 10,
  speed: 0.25,
  count: 50,
} as const

const SIMULATION = {
  referenceFramesPerSecond: 60,
  maxDeltaTimeSeconds: 0.1,
} as const

const LAYOUT = {
  canvasPadding: 48,
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
  strokeColor: string
  velocity: Vec2
  speed: number
}

type CircleBounds = { x: number; y: number; radius: number }

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

    if (
      this.canvas.width === previousWidth &&
      this.canvas.height === previousHeight
    ) {
      return
    }

    for (const listener of this.resizeListeners) {
      listener(this.width, this.height)
    }
  }
}

// --- Physics ---

function dotProduct(a: Vec2, b: Vec2) {
  return a.x * b.x + a.y * b.y
}

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

function areSpheresOverlapping(sphereA: Sphere, sphereB: Sphere) {
  return areCirclesOverlapping(sphereA, sphereB)
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

function areMovingTowardEachOther(
  sphereA: Sphere,
  sphereB: Sphere,
  directionFromAToB: Vec2,
) {
  const speedDifference = {
    x: sphereA.velocity.x - sphereB.velocity.x,
    y: sphereA.velocity.y - sphereB.velocity.y,
  }

  return dotProduct(speedDifference, directionFromAToB) > 0
}

function bounceVelocity(velocity: Vec2, surfaceNormal: Vec2): Vec2 {
  const speedAlongNormal = dotProduct(velocity, surfaceNormal)

  return {
    x: velocity.x - 2 * speedAlongNormal * surfaceNormal.x,
    y: velocity.y - 2 * speedAlongNormal * surfaceNormal.y,
  }
}

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

function pickEarliestTime(times: number[], withinTime: number) {
  let earliest: number | null = null

  for (const time of times) {
    if (
      time > PHYSICS.minCollisionTime &&
      time <= withinTime &&
      (earliest === null || time < earliest)
    ) {
      earliest = time
    }
  }

  return earliest
}

function solveEarliestTouchTime(
  centerOffsetX: number,
  centerOffsetY: number,
  speedDifferenceX: number,
  speedDifferenceY: number,
  touchRadius: number,
  withinTime: number,
): number | null {
  const currentDistanceSquared =
    centerOffsetX * centerOffsetX + centerOffsetY * centerOffsetY

  if (currentDistanceSquared <= touchRadius * touchRadius) {
    return null
  }

  const speedDifferenceSquared =
    speedDifferenceX * speedDifferenceX + speedDifferenceY * speedDifferenceY
  if (speedDifferenceSquared < 1e-10) return null

  const distanceChangeRate =
    2 *
    (centerOffsetX * speedDifferenceX + centerOffsetY * speedDifferenceY)
  const distanceGapSquared = currentDistanceSquared - touchRadius * touchRadius
  const discriminant =
    distanceChangeRate * distanceChangeRate -
    4 * speedDifferenceSquared * distanceGapSquared

  if (discriminant < 0) return null

  const sqrtDiscriminant = Math.sqrt(discriminant)
  const denominator = 2 * speedDifferenceSquared

  return pickEarliestTime(
    [
      (-distanceChangeRate - sqrtDiscriminant) / denominator,
      (-distanceChangeRate + sqrtDiscriminant) / denominator,
    ],
    withinTime,
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

function isSphereOutsideCanvas(sphere: Sphere, viewport: Viewport) {
  const { width, height } = viewport

  return (
    sphere.x - sphere.radius < 0 ||
    sphere.x + sphere.radius > width ||
    sphere.y - sphere.radius < 0 ||
    sphere.y + sphere.radius > height
  )
}

function pickEarliestWallHitTime(
  candidateTimes: Array<number | null>,
  withinTime: number,
) {
  let earliest: number | null = null

  for (const time of candidateTimes) {
    if (
      time !== null &&
      time > 0 &&
      time <= withinTime &&
      (earliest === null || time < earliest)
    ) {
      earliest = time
    }
  }

  return earliest
}

function timeUntilSphereHitsLeftWall(sphere: Sphere) {
  if (sphere.velocity.x >= 0) return null
  return (sphere.radius - sphere.x) / sphere.velocity.x
}

function timeUntilSphereHitsRightWall(sphere: Sphere, canvasWidth: number) {
  if (sphere.velocity.x <= 0) return null
  return (canvasWidth - sphere.radius - sphere.x) / sphere.velocity.x
}

function timeUntilSphereHitsTopWall(sphere: Sphere) {
  if (sphere.velocity.y >= 0) return null
  return (sphere.radius - sphere.y) / sphere.velocity.y
}

function timeUntilSphereHitsBottomWall(sphere: Sphere, canvasHeight: number) {
  if (sphere.velocity.y <= 0) return null
  return (canvasHeight - sphere.radius - sphere.y) / sphere.velocity.y
}

function timeUntilSphereHitsWall(
  sphere: Sphere,
  viewport: Viewport,
  withinTime: number,
): number | null {
  if (isSphereOutsideCanvas(sphere, viewport)) {
    return null
  }

  const { width, height } = viewport

  return pickEarliestWallHitTime(
    [
      timeUntilSphereHitsLeftWall(sphere),
      timeUntilSphereHitsRightWall(sphere, width),
      timeUntilSphereHitsTopWall(sphere),
      timeUntilSphereHitsBottomWall(sphere, height),
    ],
    withinTime,
  )
}

function pushSpheresApart(sphereA: Sphere, sphereB: Sphere, directionFromAToB: Vec2) {
  const distance = centerDistance(sphereA, sphereB)
  const desiredDistance = touchDistance(sphereA, sphereB) + PHYSICS.gapAfterContact

  if (distance >= desiredDistance) return

  const overlap = desiredDistance - distance
  const pushX = (overlap / 2) * directionFromAToB.x
  const pushY = (overlap / 2) * directionFromAToB.y

  sphereA.x -= pushX
  sphereA.y -= pushY
  sphereB.x += pushX
  sphereB.y += pushY
}

function handleSpheresTouching(sphereA: Sphere, sphereB: Sphere) {
  const directionFromAToB = unitDirectionFromAToB(sphereA, sphereB)

  if (areMovingTowardEachOther(sphereA, sphereB, directionFromAToB)) {
    sphereA.velocity = bounceVelocity(sphereA.velocity, directionFromAToB)
    sphereB.velocity = bounceVelocity(sphereB.velocity, directionFromAToB)
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
        if (areSpheresOverlapping(spheres[i], spheres[j])) {
          handleSpheresTouching(spheres[i], spheres[j])
          fixedAnyOverlap = true
        }
      }
    }

    if (!fixedAnyOverlap) break
  }
}

function bounceSphereOffLeftWall(sphere: Sphere) {
  sphere.x = sphere.radius + PHYSICS.gapAfterContact
  if (sphere.velocity.x < 0) sphere.velocity.x *= -1
  normalizeSphereSpeed(sphere)
}

function bounceSphereOffRightWall(sphere: Sphere, canvasWidth: number) {
  sphere.x = canvasWidth - sphere.radius - PHYSICS.gapAfterContact
  if (sphere.velocity.x > 0) sphere.velocity.x *= -1
  normalizeSphereSpeed(sphere)
}

function bounceSphereOffTopWall(sphere: Sphere) {
  sphere.y = sphere.radius + PHYSICS.gapAfterContact
  if (sphere.velocity.y < 0) sphere.velocity.y *= -1
  normalizeSphereSpeed(sphere)
}

function bounceSphereOffBottomWall(sphere: Sphere, canvasHeight: number) {
  sphere.y = canvasHeight - sphere.radius - PHYSICS.gapAfterContact
  if (sphere.velocity.y > 0) sphere.velocity.y *= -1
  normalizeSphereSpeed(sphere)
}

function handleSphereOutsideWall(sphere: Sphere, viewport: Viewport) {
  const { width, height } = viewport

  if (sphere.x - sphere.radius < 0) {
    bounceSphereOffLeftWall(sphere)
  } else if (sphere.x + sphere.radius > width) {
    bounceSphereOffRightWall(sphere, width)
  }

  if (sphere.y - sphere.radius < 0) {
    bounceSphereOffTopWall(sphere)
  } else if (sphere.y + sphere.radius > height) {
    bounceSphereOffBottomWall(sphere, height)
  }
}

function fixSpheresOutsideWalls(spheres: Sphere[], viewport: Viewport) {
  for (const sphere of spheres) {
    handleSphereOutsideWall(sphere, viewport)
  }
}

type CollisionEvent =
  | { kind: 'none' }
  | { kind: 'wall'; sphereIndex: number; time: number }
  | { kind: 'sphere'; sphereAIndex: number; sphereBIndex: number; time: number }

function findNextCollision(
  spheres: Sphere[],
  viewport: Viewport,
  withinTime: number,
): CollisionEvent {
  let nextEvent: CollisionEvent = { kind: 'none' }
  let nextTime = withinTime

  for (let sphereIndex = 0; sphereIndex < spheres.length; sphereIndex++) {
    const wallHitTime = timeUntilSphereHitsWall(
      spheres[sphereIndex],
      viewport,
      nextTime,
    )

    if (wallHitTime !== null && wallHitTime < nextTime) {
      nextTime = wallHitTime
      nextEvent = { kind: 'wall', sphereIndex, time: wallHitTime }
    }
  }

  for (let sphereAIndex = 0; sphereAIndex < spheres.length; sphereAIndex++) {
    for (
      let sphereBIndex = sphereAIndex + 1;
      sphereBIndex < spheres.length;
      sphereBIndex++
    ) {
      const touchTime = timeUntilSpheresTouch(
        spheres[sphereAIndex],
        spheres[sphereBIndex],
        nextTime,
      )

      if (touchTime !== null && touchTime < nextTime) {
        nextTime = touchTime
        nextEvent = {
          kind: 'sphere',
          sphereAIndex,
          sphereBIndex,
          time: touchTime,
        }
      }
    }
  }

  return nextEvent
}

function moveAllSpheres(spheres: Sphere[], deltaTimeSeconds: number) {
  for (const sphere of spheres) {
    sphere.moveBy(deltaTimeSeconds)
  }
}

function respondToCollision(
  event: CollisionEvent,
  spheres: Sphere[],
  viewport: Viewport,
) {
  if (event.kind === 'sphere') {
    handleSpheresTouching(
      spheres[event.sphereAIndex],
      spheres[event.sphereBIndex],
    )
    fixOverlappingSpheres(spheres)
    return
  }

  if (event.kind === 'wall') {
    handleSphereOutsideWall(spheres[event.sphereIndex], viewport)
  }
}

function simulateSpheres(
  spheres: Sphere[],
  viewport: Viewport,
  deltaTimeSeconds: number,
) {
  fixOverlappingSpheres(spheres)
  fixSpheresOutsideWalls(spheres, viewport)

  let remainingFrameTime = deltaTimeSeconds

  for (
    let check = 0;
    check < PHYSICS.maxCollisionChecksPerFrame &&
    remainingFrameTime > PHYSICS.minCollisionTime;
    check++
  ) {
    const nextCollision = findNextCollision(
      spheres,
      viewport,
      remainingFrameTime,
    )

    if (nextCollision.kind === 'none') {
      moveAllSpheres(spheres, remainingFrameTime)
      fixSpheresOutsideWalls(spheres, viewport)
      return
    }

    moveAllSpheres(spheres, nextCollision.time)
    remainingFrameTime -= nextCollision.time

    respondToCollision(nextCollision, spheres, viewport)
    fixSpheresOutsideWalls(spheres, viewport)
  }

  if (remainingFrameTime > PHYSICS.minCollisionTime) {
    moveAllSpheres(spheres, remainingFrameTime)
    fixSpheresOutsideWalls(spheres, viewport)
  }
}

class Sphere {
  x: number
  y: number
  radius: number
  strokeColor: string
  velocity: Vec2
  speed: number

  constructor({ x, y, radius, strokeColor, velocity, speed }: SphereConfig) {
    this.x = x
    this.y = y
    this.radius = radius
    this.strokeColor = strokeColor
    this.velocity = velocity
    this.speed = speed
  }

  draw(context: CanvasRenderingContext2D) {
    context.save()
    context.translate(this.x, this.y)
    context.beginPath()
    context.strokeStyle = this.strokeColor
    context.arc(0, 0, this.radius, 0, Math.PI * 2)
    context.stroke()
    context.restore()
  }

  moveBy(deltaTimeSeconds: number) {
    this.x += this.velocity.x * deltaTimeSeconds
    this.y += this.velocity.y * deltaTimeSeconds
  }

  overlaps(other: CircleBounds) {
    return areCirclesOverlapping(this, other)
  }
}

// --- Scene ---

function createRandomSphereRadius(viewport: Viewport) {
  const minRadius = viewport.scaleToPixels(SPHERE.minRadius)
  const maxRadius = viewport.scaleToPixels(SPHERE.maxRadius)
  return minRadius + Math.floor(Math.random() * (maxRadius - minRadius))
}

function getSphereSpeedPixelsPerSecond(viewport: Viewport) {
  return (
    viewport.scaleToPixels(SPHERE.speed) *
    SIMULATION.referenceFramesPerSecond
  )
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
    !spheres.some((sphere) => sphere.overlaps({ x, y, radius })) &&
    x - radius >= 0 &&
    y - radius >= 0 &&
    x + radius <= width &&
    y + radius <= height
  )
}

class Scene {
  spheres: Sphere[]

  constructor(viewport: Viewport) {
    this.spheres = Scene.spawnSpheres(viewport)
  }

  static spawnSpheres(viewport: Viewport) {
    const { width, height } = viewport
    const spheres: Sphere[] = []
    const speed = getSphereSpeedPixelsPerSecond(viewport)

    let spawnedCount = 0
    while (spawnedCount < SPHERE.count) {
      const x = Math.floor(Math.random() * width)
      const y = Math.floor(Math.random() * height)
      const radius = createRandomSphereRadius(viewport)

      if (!canPlaceSphereAt(x, y, radius, viewport, spheres)) {
        continue
      }

      spheres.push(
        new Sphere({
          x,
          y,
          radius,
          speed,
          velocity: createRandomSphereVelocity(speed),
          strokeColor: COLORS.sphereStroke,
        }),
      )
      spawnedCount++
    }

    return spheres
  }

  update(viewport: Viewport, deltaTimeSeconds: number) {
    simulateSpheres(this.spheres, viewport, deltaTimeSeconds)
  }

  draw(context: CanvasRenderingContext2D) {
    this.spheres.forEach((sphere) => sphere.draw(context))
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
