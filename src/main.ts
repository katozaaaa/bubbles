// --- Configuration ---

const DESIGN_REFERENCE_SIZE = 800

const COLORS = {
  background: '#111111',
  sphereStroke: '#ffffff',
} as const

const SPHERE = {
  maxRadius: 100,
  minRadius: 10,
  speed: 0.5,
  count: 20,
} as const

const LAYOUT = {
  canvasPadding: 48,
} as const

// --- Types ---

type Vec2 = { x: number; y: number }

type SphereConfig = {
  x: number
  y: number
  radius: number
  strokeColor: string
  velocity: Vec2
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

function areCirclesOverlapping(a: CircleBounds, b: CircleBounds) {
  return (
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= (a.radius + b.radius) ** 2
  )
}

function resolveSphereCollision(sphereA: Sphere, sphereB: Sphere) {
  const deltaX = sphereB.x - sphereA.x
  const deltaY = sphereB.y - sphereA.y
  const distance = Math.hypot(deltaX, deltaY)
  if (distance >= sphereA.radius + sphereB.radius) return

  const normalX = deltaX / distance
  const normalY = deltaY / distance
  const relativeVelocityX = sphereA.velocity.x - sphereB.velocity.x
  const relativeVelocityY = sphereA.velocity.y - sphereB.velocity.y
  const velocityAlongNormal =
    relativeVelocityX * normalX + relativeVelocityY * normalY
  if (velocityAlongNormal > 0) return

  const impulse = -velocityAlongNormal
  const impulseX = impulse * normalX
  const impulseY = impulse * normalY

  sphereA.velocity.x += impulseX
  sphereA.velocity.y += impulseY
  sphereB.velocity.x -= impulseX
  sphereB.velocity.y -= impulseY

  const overlap = sphereA.radius + sphereB.radius - distance
  const separationX = (overlap / 2) * normalX
  const separationY = (overlap / 2) * normalY

  sphereA.x -= separationX
  sphereA.y -= separationY
  sphereB.x += separationX
  sphereB.y += separationY
}

class Sphere {
  x: number
  y: number
  radius: number
  strokeColor: string
  velocity: Vec2

  constructor({ x, y, radius, strokeColor, velocity }: SphereConfig) {
    this.x = x
    this.y = y
    this.radius = radius
    this.strokeColor = strokeColor
    this.velocity = velocity
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

  update(viewport: Viewport) {
    this.bounceOffBounds(viewport)
  }

  bounceOffBounds(viewport: Viewport) {
    const { width, height } = viewport

    this.x += this.velocity.x
    this.y += this.velocity.y

    if (this.x - this.radius < 0) {
      this.x = this.radius
      this.velocity.x *= -1
    } else if (this.x + this.radius > width) {
      this.x = width - this.radius
      this.velocity.x *= -1
    }

    if (this.y - this.radius < 0) {
      this.y = this.radius
      this.velocity.y *= -1
    } else if (this.y + this.radius > height) {
      this.y = height - this.radius
      this.velocity.y *= -1
    }
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

function createRandomSphereVelocity(viewport: Viewport): Vec2 {
  const speed = viewport.scaleToPixels(SPHERE.speed)
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
          velocity: createRandomSphereVelocity(viewport),
          strokeColor: COLORS.sphereStroke,
        }),
      )
      spawnedCount++
    }

    return spheres
  }

  processCollisions() {
    for (let i = 0; i < this.spheres.length; i++) {
      for (let j = i + 1; j < this.spheres.length; j++) {
        // resolveSphereCollision(this.spheres[i], this.spheres[j])
      }
    }
  }

  update(viewport: Viewport) {
    this.processCollisions()
    this.spheres.forEach((sphere) => sphere.update(viewport))
    this.processCollisions()
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
    const renderFrame = () => {
      this.renderer.clear()
      this.renderer.fillBackground()
      this.scene.update(this.viewport)
      this.scene.draw(this.renderer.context)

      requestAnimationFrame(renderFrame)
    }

    renderFrame()
  }
}

// --- Bootstrap ---

const engine = new Engine('canvas')
engine.start()
