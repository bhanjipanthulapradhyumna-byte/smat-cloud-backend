% 3D surface visualization
clc; clear; close all;
[X,Y] = meshgrid(-3:0.1:3);
R = sqrt(X.^2 + Y.^2);
Z = cos(R).*exp(-0.15*R);
surf(X,Y,Z);
title('Damped radial surface'); xlabel('X'); ylabel('Y'); zlabel('Z');
