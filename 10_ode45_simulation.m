% ODE simulation and plot (Octave)
clc; clear; close all;
f = @(t,y) -0.7*y + sin(2*t);
[t,y] = ode45(f,[0 20],0);
plot(t,y,'LineWidth',1.5); grid on;
title('ODE response'); xlabel('Time'); ylabel('y(t)');
