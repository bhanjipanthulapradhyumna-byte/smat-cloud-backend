% 3D helix / parametric geometry
clc; clear; close all;
t = linspace(0,8*pi,1000);
x = cos(t); y = sin(t); z = t/(2*pi);
plot3(x,y,z,'LineWidth',1.5); grid on;
title('3D helix'); xlabel('x'); ylabel('y'); zlabel('z');
