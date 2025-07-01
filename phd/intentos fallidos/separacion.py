import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# Parámetros del dominio
nx, ny = 200, 50
Lx, Ly = 4.0, 1.0
dx, dy = Lx / (nx - 1), Ly / (ny - 1)

# Parámetros físicos
nu = 0.001       # Viscosidad cinemática
dt = 0.001       # Paso de tiempo
nt = 1000        # Número de pasos
rho = 1.0        # Densidad

# Inicialización de campos
u = np.zeros((ny, nx))
v = np.zeros((ny, nx))
p = np.zeros((ny, nx))

# Condiciones de frontera: entrada y presión de salida
def aplicar_bcs(u, v, p):
    u[:, 0] = 1.0               # Entrada
    u[:, -1] = u[:, -2]         # Neumann salida
    v[:, 0] = 0.0
    v[:, -1] = v[:, -2]
    
    # No-slip en paredes
    u[0, :] = 0
    u[-1, :] = 0
    v[0, :] = 0
    v[-1, :] = 0

    # Gradiente de presión adversa en salida
    for j in range(nx):
        x = j * dx
        if x > 2.0:
            p[:, j] = 0.05 * (x - 2.0)**2  # presión creciente → gradiente adverso

def build_up_b(u, v):
    b = np.zeros_like(p)
    b[1:-1,1:-1] = rho * (
        (u[1:-1,2:] - u[1:-1,0:-2]) / (2*dx) +
        (v[2:,1:-1] - v[0:-2,1:-1]) / (2*dy)
    ) / dt
    return b

def pressure_poisson(p, b):
    for _ in range(50):
        p[1:-1,1:-1] = (
            (p[1:-1,2:] + p[1:-1,0:-2]) * dy**2 +
            (p[2:,1:-1] + p[0:-2,1:-1]) * dx**2 -
            b[1:-1,1:-1] * dx**2 * dy**2
        ) / (2*(dx**2 + dy**2))
        p[:, 0] = p[:, 1]
        p[:, -1] = p[:, -2]
        p[0, :] = p[1, :]
        p[-1, :] = p[-2, :]
    return p

# Animación
fig, ax = plt.subplots(figsize=(8, 2))
X, Y = np.meshgrid(np.linspace(0, Lx, nx), np.linspace(0, Ly, ny))
contour = ax.contourf(X, Y, np.sqrt(u**2 + v**2), levels=20, cmap='jet')

def update(n):
    global u, v, p
    aplicar_bcs(u, v, p)
    b = build_up_b(u, v)
    p = pressure_poisson(p, b)

    un = u.copy()
    vn = v.copy()

    u[1:-1,1:-1] = (
        un[1:-1,1:-1] -
        un[1:-1,1:-1] * dt / dx * (un[1:-1,1:-1] - un[1:-1,0:-2]) -
        vn[1:-1,1:-1] * dt / dy * (un[1:-1,1:-1] - un[0:-2,1:-1]) -
        dt / (2*rho*dx) * (p[1:-1,2:] - p[1:-1,0:-2]) +
        nu * dt * (
            (un[1:-1,2:] - 2*un[1:-1,1:-1] + un[1:-1,0:-2]) / dx**2 +
            (un[2:,1:-1] - 2*un[1:-1,1:-1] + un[0:-2,1:-1]) / dy**2
        )
    )

    v[1:-1,1:-1] = (
        vn[1:-1,1:-1] -
        un[1:-1,1:-1] * dt / dx * (vn[1:-1,1:-1] - vn[1:-1,0:-2]) -
        vn[1:-1,1:-1] * dt / dy * (vn[1:-1,1:-1] - vn[0:-2,1:-1]) -
        dt / (2*rho*dy) * (p[2:,1:-1] - p[0:-2,1:-1]) +
        nu * dt * (
            (vn[1:-1,2:] - 2*vn[1:-1,1:-1] + vn[1:-1,0:-2]) / dx**2 +
            (vn[2:,1:-1] - 2*vn[1:-1,1:-1] + vn[0:-2,1:-1]) / dy**2
        )
    )

    aplicar_bcs(u, v, p)

    ax.clear()
    speed = np.sqrt(u**2 + v**2)
    contour = ax.contourf(X, Y, speed, levels=20, cmap='jet')
    ax.streamplot(X, Y, u, v, color='k', density=1.2)
    ax.set_title(f"Paso {n}")
    ax.set_xlim(0, Lx)
    ax.set_ylim(0, Ly)
    return contour

ani = FuncAnimation(fig, update, frames=200, interval=50)
plt.tight_layout()
plt.show()
