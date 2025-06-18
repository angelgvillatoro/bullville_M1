import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation

# Tiempo normalizado (de 0 a 1)
t = np.linspace(0, 1, 100)

# Coeficientes de fuerza (modelos simplificados)
CL_am = 10 * (1 - t)**2         # Masa añadida dominante al inicio
CL_circ = 8 * t**2              # Fuerza circulatoria crece con el tiempo
CL_total = CL_am + CL_circ      # Fuerza total

# Crear figura
fig, ax = plt.subplots()
line1, = ax.plot([], [], 'r-', label='Added-mass $C_{L,AM}$')
line2, = ax.plot([], [], 'b-', label='Circulatory $C_{L,CIRC}$')
line3, = ax.plot([], [], 'k--', label='Total $C_{L,TOTAL}$')

ax.set_xlim(0, 1)
ax.set_ylim(0, max(CL_total) + 2)
ax.set_xlabel('Normalized Time')
ax.set_ylabel('Lift Coefficient $C_L$')
ax.set_title('Perching Maneuver: Lift Components Over Time')
ax.legend(loc='upper right')

# Inicialización
def init():
    line1.set_data([], [])
    line2.set_data([], [])
    line3.set_data([], [])
    return line1, line2, line3

# Función de animación
def animate(i):
    line1.set_data(t[:i], CL_am[:i])
    line2.set_data(t[:i], CL_circ[:i])
    line3.set_data(t[:i], CL_total[:i])
    return line1, line2, line3

# Crear animación
ani = animation.FuncAnimation(fig, animate, init_func=init,
                              frames=len(t), interval=50, blit=True)

# Guardar como archivo mp4
ani.save('perching_lift_evolution.mp4', writer='ffmpeg', fps=20)

print("Animación guardada como 'perching_lift_evolution.mp4'")
