import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from IPython.display import HTML

# =============================================================================
# PARÁMETROS Y CONSTANTES
# =============================================================================
rho = 1.184
mu = 1.849e-5
nu = mu / rho
k = 0.0262
alpha = 2.22e-5
cp = 1006.0

L = 1.0
H = 0.1
u0 = 2.0
up = -1.0
T0 = 293.0
p0 = 101325.0

uc = u0 - up
pf = mu * uc * L / H**2 + p0
Tf = T0 + (mu * uc**2) / k

Re = 20.0
Pr = 10.0
Ec = 0.1
Eu = 1.0

# =============================================================================
# PARÁMETROS ADIMENSIONALES
# =============================================================================
Lx_star, Ly_star = 1.0, 1.0
nx, ny = 50, 50
dx_star = Lx_star / (nx - 1)
dy_star = Ly_star / (ny - 1)

up = -0.5
u0 = 1.0
T0_star = 1.0
T1_star = 0.0

dt_star = 0.001
nt = 500

# CFL CHECK
CFL = u0 * dt_star / dx_star + abs(up) * dt_star / dy_star
print(f"CFL = {CFL:.4f}")

# =============================================================================
# INICIALIZACIÓN
# =============================================================================
x_star = np.linspace(0, Lx_star, nx)
y_star = np.linspace(0, Ly_star, ny)
X_star, Y_star = np.meshgrid(x_star, y_star)

u_star = np.zeros((ny, nx)) + u0
v_star = np.zeros((ny, nx))
p_star = np.zeros((ny, nx))
T_star = np.zeros((ny, nx)) + T1_star

u_star[0, :] = up
u_star[-1, :] = u0
v_star[0, :] = 0
v_star[-1, :] = 0
T_star[0, :] = T0_star
T_star[-1, :] = T1_star

# Distribución exponencial fija en dirección x
v_extra = 0.5 * (1 - np.exp(-5 * x_star))  # valores entre 0 y 0.5
v_extra_2d = np.tile(v_extra, (ny, 1))     # expandido a 2D

# =============================================================================
# SIMULACIÓN
# =============================================================================
u_history, v_history, p_history, T_history, tau_history = [], [], [], [], []

for n in range(nt):
    u_old, v_old, p_old, T_old = u_star.copy(), v_star.copy(), p_star.copy(), T_star.copy()
    
    # Momentum
    for i in range(1, ny - 1):
        for j in range(1, nx - 1):
            conv_u_x = u_old[i, j] * (u_old[i, j + 1] - u_old[i, j - 1]) / (2 * dx_star)
            conv_u_y = v_old[i, j] * (u_old[i + 1, j] - u_old[i - 1, j]) / (2 * dy_star)
            diff_u_x = (u_old[i, j + 1] - 2 * u_old[i, j] + u_old[i, j - 1]) / (dx_star ** 2)
            diff_u_y = (u_old[i + 1, j] - 2 * u_old[i, j] + u_old[i - 1, j]) / (dy_star ** 2)
            grad_p_x = (p_old[i, j + 1] - p_old[i, j - 1]) / (2 * dx_star)
            u_star[i, j] = u_old[i, j] + dt_star * (-conv_u_x - conv_u_y - Eu * grad_p_x + (1 / Re) * (diff_u_x + diff_u_y))
            
            conv_v_x = u_old[i, j] * (v_old[i, j + 1] - v_old[i, j - 1]) / (2 * dx_star)
            conv_v_y = v_old[i, j] * (v_old[i + 1, j] - v_old[i - 1, j]) / (2 * dy_star)
            diff_v_x = (v_old[i, j + 1] - 2 * v_old[i, j] + v_old[i, j - 1]) / (dx_star ** 2)
            diff_v_y = (v_old[i + 1, j] - 2 * v_old[i, j] + v_old[i - 1, j]) / (dy_star ** 2)
            grad_p_y = (p_old[i + 1, j] - p_old[i - 1, j]) / (2 * dy_star)
            v_star[i, j] = v_old[i, j] + dt_star * (-conv_v_x - conv_v_y - Eu * grad_p_y + (1 / Re) * (diff_v_x + diff_v_y))

    # ➕ Aplicar la distribución vertical adicional
    v_star += v_extra_2d

    # Pressure Poisson
    for _ in range(20):
        for i in range(1, ny - 1):
            for j in range(1, nx - 1):
                p_star[i, j] = 0.25 * (p_old[i+1, j] + p_old[i-1, j] + p_old[i, j+1] + p_old[i, j-1] -
                    (dx_star * dy_star)/(2*(dx_star**2 + dy_star**2)) * (
                        (u_star[i, j+1] - u_star[i, j-1]) / (2 * dx_star) +
                        (v_star[i+1, j] - v_star[i-1, j]) / (2 * dy_star)))

    # Corrige velocidades
    for i in range(1, ny - 1):
        for j in range(1, nx - 1):
            u_star[i, j] -= dt_star * Eu * (p_star[i, j + 1] - p_star[i, j - 1]) / (2 * dx_star)
            v_star[i, j] -= dt_star * Eu * (p_star[i + 1, j] - p_star[i - 1, j]) / (2 * dy_star)
    
    # Energía
    for i in range(1, ny - 1):
        for j in range(1, nx - 1):
            conv_T_x = u_star[i, j] * (T_old[i, j + 1] - T_old[i, j - 1]) / (2 * dx_star)
            conv_T_y = v_star[i, j] * (T_old[i + 1, j] - T_old[i - 1, j]) / (2 * dy_star)
            diff_T_x = (T_old[i, j + 1] - 2 * T_old[i, j] + T_old[i, j - 1]) / (dx_star ** 2)
            diff_T_y = (T_old[i + 1, j] - 2 * T_old[i, j] + T_old[i - 1, j]) / (dy_star ** 2)
            
            Sxx = (u_star[i, j + 1] - u_star[i, j - 1]) / (2 * dx_star)
            Syy = (v_star[i + 1, j] - v_star[i - 1, j]) / (2 * dy_star)
            Sxy = 0.5 * ((u_star[i + 1, j] - u_star[i - 1, j]) / (2 * dy_star) +
                         (v_star[i, j + 1] - v_star[i, j - 1]) / (2 * dx_star))
            viscous_heating = (Ec / Re) * (2 * (Sxx**2 + Syy**2) + 4 * Sxy**2)

            T_star[i, j] = T_old[i, j] + dt_star * (-conv_T_x - conv_T_y +
                                                    (1 / (Re * Pr)) * (diff_T_x + diff_T_y) +
                                                    viscous_heating)

    # Shear stress adimensional
    tau = np.zeros((ny, nx))
    for i in range(1, ny - 1):
        for j in range(nx):
            tau[i, j] = ((u_star[i + 1, j] - u_star[i - 1, j]) / (2 * dy_star)) * H / (mu * uc)

    # Boundaries
    v_star[:, 0], v_star[:, -1] = 0, 0
    u_star[0, :], u_star[-1, :] = up, u0
    v_star[0, :], v_star[-1, :] = 0, 0
    T_star[0, :], T_star[-1, :] = T0_star, T1_star

    p_star[:, 0] = p_star[:, 1]
    p_star[:, -1] = p_star[:, -2]
    p_star[0, :] = p_star[1, :]
    p_star[-1, :] = p_star[-2, :]

    if n % 10 == 0 and len(u_history) < 100:
        u_history.append(u_star.copy())
        v_history.append(v_star.copy())
        p_history.append(p_star.copy())
        T_history.append(T_star.copy())
        tau_history.append(tau.copy())

# =============================================================================
# ANIMACIÓN
# =============================================================================
fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(12, 10))

def draw_frame(idx):
    speed = np.sqrt(u_history[idx]**2 + v_history[idx]**2)

    ax1.clear()
    cf1 = ax1.contourf(X_star, Y_star, speed, levels=20, cmap='jet')
    ax1.set_title(f'Velocidad (t*={idx*10*dt_star:.2f})')
    ax1.set_xlabel('x*')
    ax1.set_ylabel('y*')
    fig.colorbar(cf1, ax=ax1)

    ax2.clear()
    cf2 = ax2.contourf(X_star, Y_star, T_history[idx], levels=20, cmap='jet')
    ax2.set_title(f'Temperatura (t*={idx*10*dt_star:.2f})')
    ax2.set_xlabel('x*')
    ax2.set_ylabel('y*')
    fig.colorbar(cf2, ax=ax2)

    ax3.clear()
    cf3 = ax3.contourf(X_star, Y_star, p_history[idx], levels=20, cmap='viridis')
    ax3.set_title(f'Presión (t*={idx*10*dt_star:.2f})')
    ax3.set_xlabel('x*')
    ax3.set_ylabel('y*')
    fig.colorbar(cf3, ax=ax3)

    ax4.clear()
    cf4 = ax4.contourf(X_star, Y_star, tau_history[idx], levels=20, cmap='coolwarm')
    ax4.set_title(f'Shear Stress (t*={idx*10*dt_star:.2f})')
    ax4.set_xlabel('x*')
    ax4.set_ylabel('y*')
    fig.colorbar(cf4, ax=ax4)

    plt.tight_layout()

anim = FuncAnimation(fig, draw_frame, frames=len(u_history), interval=100)
plt.close()

HTML(anim.to_jshtml())
